from typing import Annotated

from pydantic_settings import NoDecode

CsvList = Annotated[list[str], NoDecode]
