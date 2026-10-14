from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings, get_settings
from core.db.session import get_session_maker


async def db_session() -> AsyncIterator[AsyncSession]:
    async with get_session_maker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


SessionDep = Annotated[AsyncSession, Depends(db_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
