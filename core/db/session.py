"""Lazy process-wide async engine and session factory.

Avoids opening connections on import; FastAPI and CLI share it.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.config import Settings, get_settings

_engine: AsyncEngine | None = None
_session_maker: async_sessionmaker[AsyncSession] | None = None


def build_engine(settings: Settings | None = None) -> AsyncEngine:
    """New engine; tests needing isolation use this."""
    config = settings or get_settings()
    return create_async_engine(
        config.database_url,
        echo=config.db_echo,
        pool_size=config.db_pool_size,
        max_overflow=config.db_max_overflow,
        # Prepared statements clash with PgBouncer.
        pool_pre_ping=True,
    )


def get_engine() -> AsyncEngine:
    """Process engine, created on first access."""
    global _engine
    if _engine is None:
        _engine = build_engine()
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    """Process session factory."""
    global _session_maker
    if _session_maker is None:
        _session_maker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,  # Objects stay usable after commit.
            autoflush=False,
        )
    return _session_maker


async def dispose_engine() -> None:
    """Close all engine connections; called on shutdown."""
    global _engine, _session_maker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_maker = None


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional session for non-request code; commits on success, rolls back on error."""
    async with get_session_maker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
