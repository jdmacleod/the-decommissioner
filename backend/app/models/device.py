from typing import TYPE_CHECKING, List, Optional
from datetime import datetime

from sqlmodel import SQLModel, Field, Relationship

from app.models.enums import DeviceType, DeviceStage

if TYPE_CHECKING:
    from app.models.job import Job
    from app.models.file_entry import FileEntry
    from app.models.snapshot import Snapshot


class DeviceBase(SQLModel):
    name: str
    device_type: DeviceType
    source_path: Optional[str] = None
    serial_number: Optional[str] = None
    notes: Optional[str] = None


class Device(DeviceBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    stage: DeviceStage = DeviceStage.registered
    staging_path: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    jobs: List["Job"] = Relationship(back_populates="device")
    file_entries: List["FileEntry"] = Relationship(back_populates="device")
    snapshots: List["Snapshot"] = Relationship(back_populates="device")


class DeviceCreate(DeviceBase):
    pass


class DeviceRead(DeviceBase):
    id: int
    stage: DeviceStage
    created_at: datetime
    updated_at: datetime


class DeviceUpdate(SQLModel):
    name: Optional[str] = None
    device_type: Optional[DeviceType] = None
    source_path: Optional[str] = None
    serial_number: Optional[str] = None
    notes: Optional[str] = None
    stage: Optional[DeviceStage] = None
    staging_path: Optional[str] = None
