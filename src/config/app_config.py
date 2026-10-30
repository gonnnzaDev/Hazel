from typing import Literal

from pydantic import BaseModel, Field

Environment = Literal["local", "test", "prod"]


class AppSection(BaseModel):
    env: Environment = "local"
    debug: bool = False
    secret_key: str = Field(min_length=1)
    admin_token: str = ""
    storage_root: str = Field(default="/data/hazel", min_length=1)

    @property
    def is_production(self) -> bool:
        return self.env == "prod"
