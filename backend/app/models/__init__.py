# Import all table models so SQLModel metadata is populated before Alembic runs.
from app.models.enums import (  # noqa: F401
    DeviceType, DeviceStage, JobType, JobStatus,
    FileStatus, StorageBackend, DependencyStatus,
)
from app.models.device import Device, DeviceCreate, DeviceRead, DeviceUpdate  # noqa: F401
from app.models.file_entry import FileEntry  # noqa: F401
from app.models.duplicate_group import DuplicateGroup  # noqa: F401
from app.models.job import Job, JobRead  # noqa: F401
from app.models.storage_target import StorageTarget, StorageTargetCreate, StorageTargetRead  # noqa: F401
from app.models.snapshot import Snapshot  # noqa: F401
from app.models.dependency import Dependency  # noqa: F401
