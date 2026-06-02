from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.job import Job


class Snapshot(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    job_id: int = Field(foreign_key="job.id")
    storage_target_id: int = Field(foreign_key="storagetarget.id")
    restic_snapshot_id: str = Field(max_length=64)
    file_count: int
    total_bytes: int
    added_bytes: int
    tags: str | None = None
    taken_at: datetime
    verified_at: datetime | None = None

    device: Optional["Device"] = Relationship(back_populates="snapshots")
    job: Optional["Job"] = Relationship(back_populates="snapshot")


class SnapshotRead(SQLModel):
    id: int
    device_id: int
    job_id: int
    storage_target_id: int
    restic_snapshot_id: str
    file_count: int
    total_bytes: int
    added_bytes: int
    tags: str | None
    taken_at: datetime
    verified_at: datetime | None
