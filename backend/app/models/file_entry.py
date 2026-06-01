from typing import TYPE_CHECKING, Optional
from datetime import datetime

from sqlalchemy import Index
from sqlmodel import SQLModel, Field, Relationship

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

    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    path: str
    relative_path: str
    size_bytes: int
    sha256: str = Field(default="", max_length=64)
    mime_type: Optional[str] = None
    mtime: datetime
    status: FileStatus = FileStatus.pending
    duplicate_group_id: Optional[int] = Field(default=None, foreign_key="duplicategroup.id")
    restic_snapshot_id: Optional[str] = None

    device: Optional["Device"] = Relationship(back_populates="file_entries")
    duplicate_group: Optional["DuplicateGroup"] = Relationship(
        back_populates="entries",
        sa_relationship_kwargs={"foreign_keys": "[FileEntry.duplicate_group_id]"},
    )
