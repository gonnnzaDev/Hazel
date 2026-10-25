from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from config.bdd_config.bdd_config import get_session_maker
from config.conf import Settings, get_settings
from events.outbox import publish_pending


async def db_session() -> AsyncIterator[AsyncSession]:
    async with get_session_maker()() as session:
        try:
            yield session
            await session.commit()
            # Fan out whatever this transaction queued, then clear the outbox.
            await publish_pending(session)
        except Exception:
            await session.rollback()
            raise


SessionDep = Annotated[AsyncSession, Depends(db_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
