# the-decommissioner — Data Models

All models use [SQLModel](https://sqlmodel.tiangolo.com/), which merges SQLAlchemy table definitions
with Pydantic schemas. Each model serves double duty as both the DB table and the API
response/request schema (with role-specific subclasses where needed).

Database: **SQLite**, stored at `~/.decommissioner/db.sqlite` (or `DATA_DIR` env override).

---

## Enumerations

```python
# backend/app/models/enums.py

from enum import Enum

class DeviceType(str, Enum):
    mac        = "mac"          # macOS laptop or desktop
    linux      = "linux"        # Linux machine
    iphone     = "iphone"
    ipad       = "ipad"
    usb_drive  = "usb_drive"    # any USB flash/thumb drive
    hard_drive = "hard_drive"   # bare HDD/SSD via enclosure or internal


class DeviceStage(str, Enum):
    """Ordered FSM states. A device moves forward; never backward."""
    registered = "registered"
    cataloging  = "cataloging"   # catalog job running
    cataloged   = "cataloged"
    analyzing   = "analyzing"    # duplicate analysis running
    analyzed    = "analyzed"
    migrating   = "migrating"    # restic backup running
    migrated    = "migrated"
    verifying   = "verifying"    # restic check running
    verified    = "verified"
    wiping      = "wiping"       # wipe job running (or checklist in progress)
    wiped       = "wiped"
    recycled    = "recycled"     # terminal state


class JobType(str, Enum):
    catalog     = "catalog"      # run czkawka / jdupes, populate FileEntry rows
    ios_extract = "ios_extract"  # libimobiledevice extraction to staging dir
    migrate     = "migrate"      # restic backup
    verify      = "verify"       # restic check + snapshots
    wipe        = "wipe"         # nwipe / hdparm / guided checklist


class JobStatus(str, Enum):
    pending     = "pending"
    in_progress = "in_progress"
    completed   = "completed"
    failed      = "failed"
    cancelled   = "cancelled"


class FileStatus(str, Enum):
    pending   = "pending"    # not yet reviewed
    keep      = "keep"       # marked for migration
    discard   = "discard"    # intentionally excluded
    migrated  = "migrated"   # confirmed in restic snapshot
    verified  = "verified"   # confirmed by restic check


class StorageBackend(str, Enum):
    local = "local"   # absolute local path
    sftp  = "sftp"    # sftp://user@host/path
    s3    = "s3"      # s3:bucket/prefix  (restic native; works with MinIO)


class DependencyStatus(str, Enum):
    found         = "found"
    missing       = "missing"
    wrong_version = "wrong_version"
```

---

## Core Tables

### Device

The top-level entity. One row per physical device being decommissioned.

```python
# backend/app/models/device.py

from typing import Optional, List
from datetime import datetime
from sqlmodel import SQLModel, Field, Relationship


class DeviceBase(SQLModel):
    name: str = Field(description="Human-readable label, e.g. 'Jason's 2019 MBP'")
    device_type: DeviceType
    source_path: Optional[str] = Field(
        default=None,
        description="Mount point or root directory to catalog. "
                    "None for iOS devices until extraction completes."
    )
    serial_number: Optional[str] = None
    notes: Optional[str] = None


class Device(DeviceBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    stage: DeviceStage = DeviceStage.registered
    staging_path: Optional[str] = Field(
        default=None,
        description="Temp directory for iOS extractions. "
                    "Becomes source_path after ios_extract job completes."
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    jobs: List["Job"] = Relationship(back_populates="device")
    file_entries: List["FileEntry"] = Relationship(back_populates="device")
    snapshots: List["Snapshot"] = Relationship(back_populates="device")


# API schemas
class DeviceCreate(DeviceBase):
    pass

class DeviceRead(DeviceBase):
    id: int
    stage: DeviceStage
    staging_path: Optional[str] = None
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
```

**Stage transition rules** (enforced in the API layer, not the DB):

| From | To | Trigger |
|---|---|---|
| `registered` | `cataloging` | User starts catalog job |
| `cataloging` | `cataloged` | Catalog job completes successfully |
| `cataloged` | `analyzing` | User opens duplicate analysis (auto-triggered) |
| `analyzing` | `analyzed` | All duplicate groups resolved |
| `analyzed` | `migrating` | User starts migration job |
| `migrating` | `migrated` | Migration job completes |
| `migrated` | `verifying` | Verify job auto-starts after migration |
| `verifying` | `verified` | Verify job completes |
| `verified` | `wiping` | User starts wipe job or checklist |
| `wiping` | `wiped` | Wipe job completes or checklist marked done |
| `wiped` | `recycled` | User marks device as recycled |

Any stage can transition to `failed` (stored as a job-level status; device stage stays at last good state).

---

### FileEntry

One row per file discovered during cataloging. This is the largest table —
potentially millions of rows for large drives. Indexes are critical.

```python
# backend/app/models/file_entry.py

class FileEntry(SQLModel, table=True):
    __tablename__ = "file_entry"
    __table_args__ = (
        # Fast lookup by hash (for dedup grouping)
        Index("ix_fileentry_sha256", "sha256"),
        # Fast filtering by device + status (catalog browser)
        Index("ix_fileentry_device_status", "device_id", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    path: str = Field(description="Absolute path as seen on the source device")
    relative_path: str = Field(description="Path relative to source_path root")
    size_bytes: int
    sha256: str = Field(max_length=64)
    mime_type: Optional[str] = None
    mtime: datetime
    status: FileStatus = FileStatus.pending
    duplicate_group_id: Optional[int] = Field(
        default=None, foreign_key="duplicategroup.id"
    )
    # Set after migration
    restic_snapshot_id: Optional[str] = None

    device: Optional[Device] = Relationship(back_populates="file_entries")
    # foreign_keys must be explicit due to circular FK with DuplicateGroup.canonical_entry_id
    duplicate_group: Optional["DuplicateGroup"] = Relationship(
        back_populates="entries",
        sa_relationship_kwargs={"foreign_keys": "[FileEntry.duplicate_group_id]"},
    )
```

**Catalog engine responsibility**: after running czkawka/jdupes, the engine parses
output (JSON mode) and bulk-inserts `FileEntry` rows. Use SQLAlchemy `bulk_insert_mappings`
for performance — inserting millions of rows one at a time will be too slow.

---

### DuplicateGroup

Groups `FileEntry` rows that share the same content hash across any devices.
Resolution sets one entry as canonical; the rest are marked `discard`.

```python
# backend/app/models/duplicate_group.py

class DuplicateGroup(SQLModel, table=True):
    __tablename__ = "duplicategroup"

    id: Optional[int] = Field(default=None, primary_key=True)
    content_hash: str = Field(
        max_length=64,
        description="SHA-256 that all member FileEntry rows share"
    )
    canonical_entry_id: Optional[int] = Field(
        default=None,
        foreign_key="file_entry.id",
        description="The FileEntry chosen as the single copy to keep. "
                    "None until user (or auto-resolver) picks a winner."
    )
    resolved: bool = False
    auto_resolved: bool = Field(
        default=False,
        description="True if resolved by the auto-resolver, not user action"
    )
    total_size_bytes: int = Field(
        description="size_bytes * member count — shows wasted space"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)

    entries: List[FileEntry] = Relationship(back_populates="duplicate_group")
```

**Auto-resolution rules** (applied when user clicks "Auto-resolve all"):
1. Prefer the entry with the longest path depth (most organized location).
2. Break ties by newest `mtime`.
3. Break ties by `device_id` with lowest ID (earlier-registered device wins).
Auto-resolved groups are flagged so users can review them separately.

---

### Job

Represents a single execution of a backend engine (catalog, migrate, wipe, etc.).
A device may have many jobs over its lifetime (e.g., re-cataloging after adding more files).

```python
# backend/app/models/job.py

class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    job_type: JobType
    status: JobStatus = JobStatus.pending
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    exit_code: Optional[int] = None
    error_message: Optional[str] = None
    log_path: str = Field(
        description="Absolute path to the plain-text log file for this job. "
                    "Written by the runner; read back for SSE replay."
    )
    # JSON blob for job-specific config/results, e.g.:
    # catalog: {"tool": "czkawka", "files_found": 48203, "dup_groups": 1204}
    # migrate: {"restic_snapshot_id": "abc123", "bytes_added": 10240000}
    # verify:  {"discrepancy": false, "catalog_count": 46999, "snapshot_count": 46999, "missing_paths": []}
    # wipe:    {"method": "nwipe DoD 5220.22-M (3 passes)", "block_device": "/dev/sdb"}
    # wipe (Apple): {"checklist_items": [{"label": "Sign out of iCloud", "done": true}, ...]}
    job_metadata: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    device: Optional[Device] = Relationship(back_populates="jobs")
    snapshot: Optional["Snapshot"] = Relationship(back_populates="job")
```

Log files are stored at `{DATA_DIR}/logs/job_{id}.log`. The runner appends to this file
in real time; the SSE endpoint reads from it for both live streaming and replay.

---

### StorageTarget

Global configuration for the restic repository. One default target; users may
define multiple (e.g., local + offsite SFTP).

```python
# backend/app/models/storage_target.py

class StorageTarget(SQLModel, table=True):
    __tablename__ = "storagetarget"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    backend: StorageBackend
    # Examples:
    #   local:  /Volumes/BackupDrive/decommissioner
    #   sftp:   sftp://user@nas.local/backups/decommissioner
    #   s3:     s3:http://minio.local:9000/decommissioner
    path: str
    # Name of the environment variable holding the restic repo password.
    # The app never stores the password itself.
    restic_password_env: str = Field(
        default="RESTIC_PASSWORD",
        description="Env var name. User sets this before starting the service."
    )
    is_default: bool = False
    initialized: bool = Field(
        default=False,
        description="True after `restic init` has been run against this target."
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

---

### Snapshot

A record of a restic snapshot created during a migrate job.
Parsed from `restic snapshots --json` output after each migration.

```python
# backend/app/models/snapshot.py

class Snapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: int = Field(foreign_key="device.id")
    job_id: int = Field(foreign_key="job.id")
    storage_target_id: int = Field(foreign_key="storagetarget.id")
    restic_snapshot_id: str = Field(
        max_length=64,
        description="Short ID returned by restic (e.g. 'a1b2c3d4')"
    )
    file_count: int
    total_bytes: int
    added_bytes: int = Field(
        description="Net new bytes added to the repo (after dedup)"
    )
    tags: Optional[str] = Field(
        default=None,
        description="JSON list of restic tags, e.g. ['device-7', 'mac']"
    )
    taken_at: datetime
    verified_at: Optional[datetime] = None

    device: Optional[Device] = Relationship(back_populates="snapshots")
    job: Optional[Job] = Relationship(back_populates="snapshot")
```

---

### Dependency

Tracks whether required external binaries are present and at a usable version.
Checked at startup and surfaced in the UI health screen.

```python
# backend/app/models/dependency.py

class Dependency(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("name", name="uq_dependency_name"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(
        description="Binary name, e.g. 'restic', 'czkawka', 'nwipe', 'ideviceinfo'"
    )
    # JSON list of JobType values this dep is required for
    required_for: str
    status: DependencyStatus
    version: Optional[str] = None
    install_hint: str = Field(
        description="Short install command, e.g. 'brew install restic' or 'apt install restic'"
    )
    checked_at: datetime = Field(default_factory=datetime.utcnow)
```

**Required dependencies by job type:**

| Dependency | Required for | macOS install | Linux install |
|---|---|---|---|
| `restic` | migrate, verify | `brew install restic` | `apt install restic` |
| `czkawka_cli` | catalog | `brew install czkawka` | cargo/releases |
| `jdupes` | catalog (fallback) | `brew install jdupes` | `apt install jdupes` |
| `ideviceinfo` | ios_extract | `brew install libimobiledevice` | `apt install libimobiledevice-utils` |
| `ifuse` | ios_extract (Linux) | N/A | `apt install ifuse` |
| `nwipe` | wipe (HDD, Linux) | N/A | `apt install nwipe` |
| `hdparm` | wipe (SSD, Linux) | N/A | `apt install hdparm` |
| `diskutil` | wipe (macOS) | Built-in | N/A |

---

## Relationship Diagram

```
StorageTarget ──────────────────────────┐
                                        │
Device (1) ──── Job (many)             Snapshot (many)
   │               │                        │
   │               └── log_path (file)      │
   │                                        │
   └── FileEntry (many) ── DuplicateGroup (many)
                                │
                         canonical_entry_id ──> FileEntry
```

---

## Migration Strategy

Use **Alembic** for schema migrations. Initialize with:

```bash
alembic init alembic
# Set sqlalchemy.url = sqlite:///%(DATA_DIR)s/db.sqlite in alembic.ini
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

On first run, the app calls `alembic upgrade head` automatically before starting uvicorn.
This makes the Docker and native-install paths identical.
