from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index
from sqlmodel import Field, Relationship, SQLModel

from app.models.enums import FileStatus

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.duplicate_group import DuplicateGroup


class FileEntry(SQLModel, table=True):
    __tablename__ = "file_entry"
    __table_args__ = (
        Index("ix_fileentry_sha256", "sha256"),
        Index("ix_fileentry_device_status", "device_id", "status"),
    )

    id: int | None = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    path: str
    relative_path: str
    size_bytes: int
    sha256: str = Field(default="", max_length=64)
    mime_type: str | None = None
    mtime: datetime
    status: FileStatus = FileStatus.pending
    duplicate_group_id: int | None = Field(default=None, foreign_key="duplicategroup.id")
    restic_snapshot_id: str | None = None

    device: Optional["Device"] = Relationship(back_populates="file_entries")
    duplicate_group: Optional["DuplicateGroup"] = Relationship(
        back_populates="entries",
        sa_relationship_kwargs={"foreign_keys": "[FileEntry.duplicate_group_id]"},
    )
