from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

from app.models.enums import JobStatus, JobType

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.snapshot import Snapshot


class Job(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    job_type: JobType
    status: JobStatus = JobStatus.pending
    started_at: datetime | None = None
    completed_at: datetime | None = None
    exit_code: int | None = None
    error_message: str | None = None
    log_path: str
    job_metadata: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    device: Optional["Device"] = Relationship(back_populates="jobs")
    snapshot: Optional["Snapshot"] = Relationship(back_populates="job")


class JobRead(SQLModel):
    id: int
    device_id: int
    job_type: JobType
    status: JobStatus
    started_at: datetime | None
    completed_at: datetime | None
    exit_code: int | None
    error_message: str | None
    log_path: str
    job_metadata: str | None
    created_at: datetime
