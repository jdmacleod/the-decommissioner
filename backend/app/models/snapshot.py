from typing import TYPE_CHECKING, Optional
from datetime import datetime

from sqlmodel import SQLModel, Field, Relationship

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.job import Job


class Snapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    job_id: int = Field(foreign_key="job.id")
    storage_target_id: int = Field(foreign_key="storagetarget.id")
    restic_snapshot_id: str = Field(max_length=64)
    file_count: int
    total_bytes: int
    added_bytes: int
    tags: Optional[str] = None
    taken_at: datetime
    verified_at: Optional[datetime] = None

    device: Optional["Device"] = Relationship(back_populates="snapshots")
    job: Optional["Job"] = Relationship(back_populates="snapshot")
