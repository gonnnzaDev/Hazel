from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from channels import repository as channels_repository
from common.types import RecordId, new_id, utcnow
from config.conf import get_settings
from core.api.errors import (
    ConflictError,
    DomainError,
    InviteExpiredError,
    InviteNotFoundError,
    NotFoundError,
    PermissionDeniedError,
    ServerInactiveError,
    ValidationDomainError,
)
from events.outbox import queue_event
from identity.model import Member
from servers import repository as servers_repository
from servers.model import AuditEvent, Invite, Server
from servers.schemas import BackupRead, InviteCreate, RestoreRequest, ServerCreate, ServerStats
from servers.states import ServerStatus, can_transition

logger = logging.getLogger(__name__)

MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 64


def normalize_slug(raw: str) -> str:
    decomposed = unicodedata.normalize("NFKD", raw.strip().casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", without_accents).strip("-")


async def slug_taken(session: AsyncSession, slug: str, *, exclude: RecordId | None = None) -> bool:
    stmt = select(func.count()).select_from(Server).where(Server.slug == slug)
    if exclude is not None:
        stmt = stmt.where(Server.id != exclude)
    return (await session.execute(stmt)).scalar_one() > 0


def _validate_slug(raw: str) -> str:
    slug = normalize_slug(raw)
    if len(slug) < MIN_SLUG_LENGTH or len(slug) > MAX_SLUG_LENGTH:
        raise ValidationDomainError(
            "Server identifier must be between "
            f"{MIN_SLUG_LENGTH} and {MAX_SLUG_LENGTH} characters.",
            code="invalid_slug",
            extra={"slug": raw},
        )
    return slug


async def create_server(session: AsyncSession, payload: ServerCreate, *, port: int) -> Server:
    slug = _validate_slug(payload.slug)

    if await slug_taken(session, slug):
        raise ConflictError(
            f"Identifier '{slug}' is already in use.",
            code="slug_taken",
            extra={"slug": slug},
        )

    server = Server(
        id=new_id(),
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
        status=ServerStatus.CREATING,
        bind_port=port,
        max_members=payload.max_members,
    )

    session.add(server)
    await session.flush()

    server.channels.append(channels_repository.default_channel())
    await session.flush()

    logger.info("server registered slug=%s port=%s", server.slug, port)
    return server


async def activate_server(session: AsyncSession, server: Server) -> Server:
    if server.status is ServerStatus.ACTIVE:
        server.last_heartbeat_at = utcnow()
        await session.flush()
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "This server was deleted and cannot be reactivated.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.ACTIVE):
        raise ConflictError(
            f"Cannot activate a server in state '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.ACTIVE.value},
        )

    server.status = ServerStatus.ACTIVE
    server.last_heartbeat_at = utcnow()
    await session.flush()

    await queue_event(
        session,
        "server.state_changed",
        server_id=server.id,
        data={"slug": server.slug, "status": server.status.value},
    )
    logger.info("server activated slug=%s", server.slug)
    return server


async def deactivate_server(session: AsyncSession, server: Server) -> Server:
    if server.status is ServerStatus.INACTIVE:
        return server

    if server.status is ServerStatus.DELETED:
        raise ConflictError(
            "This server was already deleted.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.INACTIVE):
        raise ConflictError(
            f"Cannot deactivate a server in state '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.INACTIVE.value},
        )

    server.status = ServerStatus.INACTIVE
    await session.flush()

    await queue_event(
        session,
        "server.state_changed",
        server_id=server.id,
        data={"slug": server.slug, "status": server.status.value},
    )
    logger.info("server deactivated slug=%s", server.slug)
    return server


async def delete_server(session: AsyncSession, server: Server) -> None:
    if server.status.is_terminal:
        raise ConflictError(
            "This server was already deleted.",
            code="server_deleted",
            extra={"server_id": str(server.id)},
        )

    if not can_transition(server.status, ServerStatus.DELETED):
        raise ConflictError(
            f"Cannot delete a server in state '{server.status.value}'.",
            code="invalid_state_transition",
            extra={"current": server.status.value, "target": ServerStatus.DELETED.value},
        )

    slug = server.slug
    await session.delete(server)
    await queue_event(
        session,
        "server.state_changed",
        server_id=server.id,
        data={"slug": slug, "status": ServerStatus.DELETED.value},
    )
    logger.info("server deleted slug=%s", slug)


def ensure_active(server: Server) -> None:
    if not server.status.accepts_traffic:
        raise ServerInactiveError(
            f"Server is {server.status.value}. It accepts no connections until "
            f"its owner reactivates it.",
            extra={"server_id": str(server.id), "status": server.status.value},
        )


def ensure_member_of(member: Member, server_id: RecordId) -> None:
    if member.server_id != server_id:
        raise PermissionDeniedError(
            "You don't have access to this server.",
            code="wrong_server",
            extra={"server_id": str(server_id)},
        )


def ensure_can_invite(member: Member) -> None:
    if not member.role_enum.can_administer:
        raise PermissionDeniedError(
            "You must be an administrator to create invites.",
            code="not_admin",
        )


async def create_invite(
    session: AsyncSession, server: Server, actor: Member, payload: InviteCreate
) -> Invite:
    ensure_can_invite(actor)

    now = utcnow()
    invite = Invite(
        code=uuid4().hex[:8].upper(),
        server_id=server.id,
        created_by=actor.nickname,
        created_at=now,
        expires_at=now + timedelta(seconds=payload.ttl_seconds),
        single_use=payload.single_use,
        consumed=False,
    )
    session.add(invite)
    await session.flush()
    return invite


async def get_invite(session: AsyncSession, code: str) -> Invite:
    invite = await servers_repository.get_invite_by_code(session, code)
    if invite is None:
        raise InviteNotFoundError("Invite not found.", extra={"code": code})

    if invite.expires_at < utcnow():
        raise InviteExpiredError("Invite expired.", extra={"code": code})

    if invite.single_use and invite.consumed:
        raise ConflictError("Invite already used.", code="invite_invalid", extra={"code": code})

    if invite.single_use and not invite.consumed:
        invite.consumed = True
        await session.flush()

    return invite


async def delete_invite(session: AsyncSession, code: str) -> None:
    await servers_repository.delete_invite(session, code)


async def record_audit(
    session: AsyncSession,
    *,
    server_id: RecordId,
    actor_nickname: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    data: dict[str, object] | None = None,
) -> AuditEvent:
    return await servers_repository.create_audit_event(
        session,
        server_id=server_id,
        actor_nickname=actor_nickname,
        action=action,
        target_type=target_type,
        target_id=target_id,
        data=data,
    )


async def get_server_stats(session: AsyncSession, server_id: RecordId) -> ServerStats:
    await servers_repository.get_server(session, server_id)
    members, messages, attachment_bytes, db_bytes = await servers_repository.server_stats(
        session, server_id
    )
    total = attachment_bytes + db_bytes
    return ServerStats(
        server_id=server_id,
        members=members,
        messages=messages,
        attachment_bytes=attachment_bytes,
        db_bytes=db_bytes,
        total_bytes=total,
    )


def _backup_dir(server_id: RecordId) -> Path:
    root = Path(get_settings().storage_root)
    path = root / "backups" / str(server_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


async def create_backup(session: AsyncSession, server_id: RecordId) -> BackupRead:
    server = await servers_repository.get_server(session, server_id)
    backup_id = uuid4().hex
    created_at = datetime.now(UTC)
    payload = {
        "backup_id": backup_id,
        "server_id": str(server.id),
        "slug": server.slug,
        "name": server.name,
        "status": server.status.value,
        "created_at": created_at.isoformat(),
    }
    path = _backup_dir(server_id) / f"{backup_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return BackupRead(
        backup_id=backup_id,
        path=str(path),
        size=path.stat().st_size,
        created_at=created_at,
    )


def _resolve_backup_path(server_id: RecordId, payload: RestoreRequest) -> Path:
    base = _backup_dir(server_id)
    if payload.backup_id:
        path = (base / f"{payload.backup_id}.json").resolve()
    elif payload.path:
        path = Path(payload.path).resolve()
    else:
        raise ValidationDomainError(
            "Provide backup_id or path.",
            code="invalid_restore_request",
        )
    if (
        base.resolve() not in path.parents
        and path.parent != base.resolve()
        and payload.backup_id is None
    ):
        raise ValidationDomainError(
            "Backup path must be within the server backup directory.",
            code="invalid_backup_path",
        )
    if not path.exists() or not path.is_file():
        raise NotFoundError("Backup not found.", code="backup_not_found", extra={"path": str(path)})
    return path


async def restore_backup(
    session: AsyncSession, server_id: RecordId, payload: RestoreRequest
) -> Server:
    server = await servers_repository.get_server(session, server_id)
    path = _resolve_backup_path(server_id, payload)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise DomainError(
            "Invalid backup file.",
            code="invalid_backup_file",
            status_code=422,
        ) from exc
    if str(data.get("server_id")) != str(server_id):
        raise ValidationDomainError(
            "Backup does not belong to this server.",
            code="backup_server_mismatch",
            extra={"server_id": str(server_id)},
        )
    # Minimal restore: refresh known mutable fields if present
    if isinstance(data.get("name"), str):
        server.name = data["name"]
    if "description" in data:
        server.description = data.get("description")
    await session.flush()
    return server
