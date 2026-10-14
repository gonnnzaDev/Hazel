from pydantic import BaseModel, Field


class DbSection(BaseModel):
    database_url: str = "postgresql+asyncpg://hazel:hazel@localhost:5432/hazel"
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=20, ge=0)
    db_echo: bool = False

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+asyncpg", "")
