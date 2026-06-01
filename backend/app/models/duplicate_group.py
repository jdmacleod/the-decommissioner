from typing import TYPE_CHECKING, List, Optional
from datetime import datetime

from sqlmodel import SQLModel, Field, Relationship

if TYPE_CHECKING:
    from app.models.file_entry import FileEntry


class DuplicateGroup(SQLModel, table=True):
    __tablename__ = "duplicategroup"

    id: Optional[int] = Field(default=None, primary_key=True)
    content_hash: str = Field(max_length=64)
    canonical_entry_id: Optional[int] = Field(default=None, foreign_key="file_entry.id")
    resolved: bool = False
    auto_resolved: bool = False
    total_size_bytes: int
    created_at: datetime = Field(default_factory=datetime.utcnow)

    entries: List["FileEntry"] = Relationship(
        back_populates="duplicate_group",
        sa_relationship_kwargs={"foreign_keys": "[FileEntry.duplicate_group_id]"},
    )
