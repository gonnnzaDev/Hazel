"""Engine y sesión de SQLAlchemy async.

El engine se crea de forma perezosa y vive a nivel de proceso, para no abrir
conexiones al importar el módulo. FastAPI usa `session_scope` como dependencia;
el CLI y los scripts usan el context manager directamente.
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
    """Crea un engine nuevo. Usado por tests que necesitan un engine aislado."""
    config = settings or get_settings()
    return create_async_engine(
        config.database_url,
        echo=config.db_echo,
        pool_size=config.db_pool_size,
        max_overflow=config.db_max_overflow,
        # Prepared statements + PgBouncer no se mixes bien.
        pool_pre_ping=True,
    )


def get_engine() -> AsyncEngine:
    """Devuelve el engine del proceso, creándolo en el primer acceso."""
    global _engine
    if _engine is None:
        _engine = build_engine()
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    """Devuelve el factory de sesiones del proceso."""
    global _session_maker
    if _session_maker is None:
        _session_maker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,  # los objetos siguen usables tras commit
            autoflush=False,
        )
    return _session_maker


async def dispose_engine() -> None:
    """Cierra todas las conexiones del engine. Se llama en el shutdown."""
    global _engine, _session_maker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_maker = None


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Sesión transaccable para uso fuera del ciclo de requests.

    Hace commit implícito al salir sin excepción y rollback ante error.
    """
    async with get_session_maker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
