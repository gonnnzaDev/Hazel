from __future__ import annotations

import hashlib
import logging
import re
import secrets
import unicodedata
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from channels import repository as channels_repository
from common.types import RecordId, new_id, utcnow
from core.api.errors import (
    ConflictError,
    PermissionDeniedError,
    ServerInactiveError,
    ValidationDomainError,
)
from events.outbox import queue_event
from servers import repository as servers_repository
from servers.model import AuditEvent, Invite, Server
from servers.schemas import InviteCreate, ServerCreate
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


async def create_server(session: AsyncSession, payload: ServerCreate, *, port: int) -> Server:
    slug = normalize_slug(payload.slug)
    if len(slug) < MIN_SLUG_LENGTH or len(slug) > MAX_SLUG_LENGTH:
        raise ValidationDomainError(
            "Server identifier must be between "
            f"{MIN_SLUG_LENGTH} and {MAX_SLUG_LENGTH} characters.",
            code="invalid_slug",
            extra={"slug": payload.slug},
        )

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


INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _hash_password(password: str | None) -> str | None:
    if password is None:
        return None
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))


async def create_invite(
    session: AsyncSession,
    server: Server,
    member: object,
    payload: InviteCreate,
) -> Invite:
    role_enum = getattr(member, "role_enum", None)
    if role_enum is None or not getattr(role_enum, "can_administer", False):
        raise PermissionDeniedError(
            "You must be an administrator to create invites.",
            code="not_admin",
        )

    invite = Invite(
        id=new_id(),
        server_id=server.id,
        code=_generate_code(),
        created_by=getattr(member, "nickname", ""),
        expires_at=utcnow() + timedelta(seconds=payload.ttl_seconds),
        single_use=payload.single_use,
        password_hash=_hash_password(payload.password),
    )
    session.add(invite)
    await session.flush()
    return invite


async def get_invite(
    session: AsyncSession,
    code: str,
    *,
    password: str | None = None,
) -> Invite:
    invite = await servers_repository.get_invite_by_code(session, code)
    if invite is None:
        from core.api.errors import InviteNotFoundError

        raise InviteNotFoundError(
            "That invite does not exist.",
            code="invite_not_found",
            extra={"code": code},
        )
    if invite.expires_at <= utcnow():
        from core.api.errors import InviteExpiredError

        raise InviteExpiredError(
            "That invite has expired.",
            code="invite_expired",
            extra={"code": code},
        )
    if invite.single_use and invite.consumed:
        raise ConflictError(
            "That invite is no longer valid.",
            code="invite_invalid",
            extra={"code": code},
        )
    if getattr(invite, "password_hash", None) is not None and (
        password is None or _hash_password(password) != invite.password_hash
    ):
        raise PermissionDeniedError(
            "The invite password is missing or incorrect.",
            code="invite_password_invalid",
        )
    if invite.single_use and not invite.consumed:
        invite.consumed = True
        await session.flush()
    return invite


async def delete_invite(
    session: AsyncSession,
    member: object,
    code: str,
) -> None:
    invite = await servers_repository.get_invite_by_code(session, code)
    if invite is None:
        from core.api.errors import InviteNotFoundError

        raise InviteNotFoundError(
            "That invite does not exist.",
            code="invite_not_found",
            extra={"code": code},
        )
    if str(invite.server_id) != str(getattr(member, "server_id", None)):
        raise PermissionDeniedError(
            "This token belongs to another server.",
            code="wrong_server",
        )
    role_enum = getattr(member, "role_enum", None)
    if role_enum is None or not getattr(role_enum, "can_administer", False):
        raise PermissionDeniedError(
            "You must be an administrator to revoke invites.",
            code="not_admin",
        )
    await servers_repository.delete_invite(session, invite)


async def record_audit(
    session: AsyncSession,
    *,
    server_id: RecordId,
    actor_nickname: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    data: dict[str, object] | None = None,
) -> None:
    await servers_repository.create_audit_event(
        session,
        server_id=server_id,
        actor_nickname=actor_nickname,
        action=action,
        target_type=target_type,
        target_id=target_id,
        data=data,
    )


async def list_audit_events(
    session: AsyncSession, server_id: RecordId, *, limit: int = 50, offset: int = 0
) -> tuple[list[AuditEvent], int]:
    return await servers_repository.list_audit_events(
        session, server_id, limit=limit, offset=offset
    )


async def get_server_stats(session: AsyncSession, server_id: RecordId) -> dict[str, object]:
    from sqlalchemy import func, select, text

    from channels.model import Channel
    from identity.model import Member
    from messages.model import Attachment, Message

    members_count = (
        await session.execute(
            select(func.count()).select_from(Member).where(Member.server_id == server_id)
        )
    ).scalar_one()

    messages_count = (
        await session.execute(
            select(func.count())
            .select_from(Message)
            .join(Channel, Message.channel_id == Channel.id)
            .where(Channel.server_id == server_id)
        )
    ).scalar_one()

    attachment_bytes = (
        await session.execute(
            select(func.coalesce(func.sum(Attachment.size), 0))
            .select_from(Attachment)
            .join(Message, Attachment.message_id == Message.id)
            .join(Channel, Message.channel_id == Channel.id)
            .where(Channel.server_id == server_id)
        )
    ).scalar_one()

    db_bytes = (
        await session.execute(text("SELECT pg_database_size(current_database())"))
    ).scalar_one()

    return {
        "server_id": server_id,
        "members": int(members_count),
        "messages": int(messages_count),
        "attachment_bytes": int(attachment_bytes or 0),
        "db_bytes": int(db_bytes or 0),
        "total_bytes": int((attachment_bytes or 0) + (db_bytes or 0)),
    }


async def create_backup(
    session: AsyncSession,
    server_id: RecordId,
    member: object,
) -> dict[str, object]:
    import json
    import tarfile
    import tempfile
    from pathlib import Path

    from sqlalchemy import select

    from config.bdd_config.bdd_config import Base
    from config.conf import get_settings

    settings = get_settings()
    storage_root = Path(settings.storage_root)
    backup_dir = storage_root / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    backup_id = str(new_id())
    backup_path = backup_dir / f"{backup_id}.tar.gz"

    # Export every mapped table to JSON for portability.
    db_data: dict[str, list[dict[str, object]]] = {}
    for table in Base.metadata.sorted_tables:
        result = await session.execute(select(table))
        db_data[table.name] = [dict(row._mapping) for row in result]

    with tempfile.TemporaryDirectory() as tmp:
        db_json = Path(tmp) / "database.json"
        db_json.write_text(json.dumps(db_data, default=str), encoding="utf-8")

        with tarfile.open(backup_path, "w:gz") as tar:
            import asyncio

            files = await asyncio.to_thread(lambda: list(storage_root.rglob("*")))
            for path in files:
                if backup_dir in path.parents or path == backup_dir:
                    continue
                if path.is_file():
                    tar.add(path, arcname=str(path.relative_to(storage_root)))
            tar.add(db_json, arcname="database.json")

    return {
        "backup_id": backup_id,
        "path": str(backup_path),
        "size": int(backup_path.stat().st_size),
        "created_at": utcnow(),
    }


async def restore_backup(
    session: AsyncSession,
    server_id: RecordId,
    backup_id: str | None,
    path: str | None,
) -> None:
    import tarfile
    from pathlib import Path

    from config.conf import get_settings

    settings = get_settings()
    storage_root = Path(settings.storage_root)
    backup_path = Path(path) if path else storage_root / "backups" / f"{backup_id}.tar.gz"
    if not backup_path.exists():
        from core.api.errors import NotFoundError

        raise NotFoundError(
            "That backup does not exist.",
            code="backup_not_found",
            extra={"path": str(backup_path)},
        )
    with tarfile.open(backup_path, "r:gz") as tar:
        for member in tar.getmembers():
            target = storage_root / member.name
            if not str(target).startswith(str(storage_root)):
                raise ValueError("Unsafe backup member path")
        tar.extractall(path=storage_root, filter="data")
