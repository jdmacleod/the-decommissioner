from enum import Enum


class DeviceType(str, Enum):
    mac        = "mac"
    linux      = "linux"
    iphone     = "iphone"
    ipad       = "ipad"
    usb_drive  = "usb_drive"
    hard_drive = "hard_drive"


class DeviceStage(str, Enum):
    registered = "registered"
    cataloging  = "cataloging"
    cataloged   = "cataloged"
    analyzing   = "analyzing"
    analyzed    = "analyzed"
    migrating   = "migrating"
    migrated    = "migrated"
    verifying   = "verifying"
    verified    = "verified"
    wiping      = "wiping"
    wiped       = "wiped"
    recycled    = "recycled"


class JobType(str, Enum):
    catalog     = "catalog"
    ios_extract = "ios_extract"
    migrate     = "migrate"
    verify      = "verify"
    wipe        = "wipe"


class JobStatus(str, Enum):
    pending     = "pending"
    in_progress = "in_progress"
    completed   = "completed"
    failed      = "failed"
    cancelled   = "cancelled"


class FileStatus(str, Enum):
    pending   = "pending"
    keep      = "keep"
    discard   = "discard"
    migrated  = "migrated"
    verified  = "verified"


class StorageBackend(str, Enum):
    local = "local"
    sftp  = "sftp"
    s3    = "s3"


class DependencyStatus(str, Enum):
    found         = "found"
    missing       = "missing"
    wrong_version = "wrong_version"
