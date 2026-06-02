from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.enums import StorageBackend


class StorageTarget(SQLModel, table=True):
    __tablename__ = "storagetarget"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    backend: StorageBackend
    path: str
    restic_password_env: str = Field(default="RESTIC_PASSWORD")
    is_default: bool = False
    initialized: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StorageTargetCreate(SQLModel):
    name: str
    backend: StorageBackend
    path: str
    restic_password_env: str = "RESTIC_PASSWORD"
    is_default: bool = False


class StorageTargetUpdate(SQLModel):
    name: str | None = None
    backend: StorageBackend | None = None
    path: str | None = None
    restic_password_env: str | None = None
    is_default: bool | None = None


class StorageTargetRead(SQLModel):
    id: int
    name: str
    backend: StorageBackend
    path: str
    restic_password_env: str
    is_default: bool
    initialized: bool
    created_at: datetime
