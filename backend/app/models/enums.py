from enum import StrEnum


class DeviceType(StrEnum):
    mac = "mac"
    linux = "linux"
    iphone = "iphone"
    ipad = "ipad"
    usb_drive = "usb_drive"
    hard_drive = "hard_drive"


class DeviceStage(StrEnum):
    registered = "registered"
    cataloging = "cataloging"
    cataloged = "cataloged"
    analyzing = "analyzing"
    analyzed = "analyzed"
    migrating = "migrating"
    migrated = "migrated"
    verifying = "verifying"
    verified = "verified"
    wiping = "wiping"
    wiped = "wiped"
    recycled = "recycled"


class JobType(StrEnum):
    catalog = "catalog"
    ios_extract = "ios_extract"
    migrate = "migrate"
    verify = "verify"
    wipe = "wipe"


class JobStatus(StrEnum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class FileStatus(StrEnum):
    pending = "pending"
    keep = "keep"
    discard = "discard"
    migrated = "migrated"
    verified = "verified"


class StorageBackend(StrEnum):
    local = "local"
    sftp = "sftp"
    s3 = "s3"


class DependencyStatus(StrEnum):
    found = "found"
    missing = "missing"
    wrong_version = "wrong_version"
