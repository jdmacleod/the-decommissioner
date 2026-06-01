from typing import TYPE_CHECKING, Optional
from datetime import datetime

from sqlmodel import SQLModel, Field, Relationship

from app.models.enums import JobType, JobStatus

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.snapshot import Snapshot


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    job_type: JobType
    status: JobStatus = JobStatus.pending
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    exit_code: Optional[int] = None
    error_message: Optional[str] = None
    log_path: str
    job_metadata: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    device: Optional["Device"] = Relationship(back_populates="jobs")
    snapshot: Optional["Snapshot"] = Relationship(back_populates="job")


class JobRead(SQLModel):
    id: int
    device_id: int
    job_type: JobType
    status: JobStatus
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    exit_code: Optional[int]
    error_message: Optional[str]
    log_path: str
    job_metadata: Optional[str]
    created_at: datetime
