from datetime import datetime
from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

from app.models.enums import DeviceStage, DeviceType

if TYPE_CHECKING:
    from app.models.file_entry import FileEntry
    from app.models.job import Job
    from app.models.snapshot import Snapshot


class DeviceBase(SQLModel):
    name: str
    device_type: DeviceType
    source_path: str | None = None
    serial_number: str | None = None
    notes: str | None = None


class Device(DeviceBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    stage: DeviceStage = DeviceStage.registered
    staging_path: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    jobs: list["Job"] = Relationship(back_populates="device")
    file_entries: list["FileEntry"] = Relationship(back_populates="device")
    snapshots: list["Snapshot"] = Relationship(back_populates="device")


class DeviceCreate(DeviceBase):
    pass


class DeviceRead(DeviceBase):
    id: int
    stage: DeviceStage
    staging_path: str | None = None
    created_at: datetime
    updated_at: datetime


class DeviceUpdate(SQLModel):
    name: str | None = None
    device_type: DeviceType | None = None
    source_path: str | None = None
    serial_number: str | None = None
    notes: str | None = None
    stage: DeviceStage | None = None
    staging_path: str | None = None
