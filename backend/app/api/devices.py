import asyncio
import contextlib
import os
import shutil
import subprocess
import sys
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import select

from app.core.config import settings
from app.core.deps import SessionDep, get_runner
from app.core.job_factory import create_job
from app.models.device import Device, DeviceCreate, DeviceRead, DeviceUpdate
from app.models.duplicate_group import DuplicateGroup
from app.models.enums import DeviceStage, JobStatus, JobType, StorageType
from app.models.job import Job

PHOTO_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
PHOTO_ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

# Valid stage transitions triggered by starting a job
JOB_START_TRANSITIONS: dict[JobType, tuple[DeviceStage, DeviceStage]] = {
    JobType.catalog: (DeviceStage.registered, DeviceStage.cataloging),
    JobType.ios_extract: (DeviceStage.registered, DeviceStage.cataloging),
    JobType.migrate: (DeviceStage.analyzed, DeviceStage.migrating),
    JobType.verify: (DeviceStage.migrated, DeviceStage.verifying),
    JobType.wipe: (DeviceStage.verified, DeviceStage.wiping),
}

# Re-catalog is allowed from cataloged stage too
RECATALOG_STAGES = {DeviceStage.cataloged, DeviceStage.registered}

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[DeviceRead])
def list_devices(session: SessionDep):
    return session.exec(select(Device)).all()


@router.post("", response_model=DeviceRead, status_code=201)
def create_device(body: DeviceCreate, session: SessionDep):
    device = Device.model_validate(body)
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@router.get("/detect-ios")
def detect_ios() -> dict:
    from app.engines.ios import detect_ios_device

    return detect_ios_device()


_NETWORK_FS_TYPES = {"smbfs", "cifs", "nfs", "nfs4", "afpfs", "osxfusefs", "fuse.sshfs", "macfuse"}


class VolumeEntry(BaseModel):
    path: str
    label: str
    serial_number: str | None = None
    is_network_mount: bool = False


def _get_mount_types() -> dict[str, str]:
    """Return {mount_point: fs_type} by parsing `mount` output. Best-effort; returns {} on error."""
    try:
        r = subprocess.run(["mount"], capture_output=True, text=True, timeout=5)
        if r.returncode != 0 or not isinstance(r.stdout, str):
            return {}
        result: dict[str, str] = {}
        for line in r.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            # Linux: "<device> on <mount> type <fstype> (<opts>)"
            if " type " in line:
                on_split = line.split(" on ", 1)
                if len(on_split) == 2:
                    after_on = on_split[1]
                    type_split = after_on.split(" type ", 1)
                    if len(type_split) == 2:
                        mount = type_split[0].strip()
                        fs_part = type_split[1].split("(", 1)[0].strip()
                        result[mount] = fs_part
            # macOS: "<device> on <mount> (<fstype>, <opts>...)"
            elif " on " in line and "(" in line:
                on_split = line.split(" on ", 1)
                if len(on_split) == 2:
                    rest = on_split[1]
                    paren_idx = rest.rfind(" (")
                    if paren_idx != -1:
                        mount = rest[:paren_idx].strip()
                        opts = rest[paren_idx + 2 :].rstrip(")")
                        fs_type = opts.split(",")[0].strip()
                        result[mount] = fs_type
        return result
    except Exception:
        return {}


def _serial_for_path(path: str) -> str | None:
    """Best-effort: return a hardware serial or Volume UUID for a mounted volume."""
    if sys.platform == "darwin":
        try:
            import plistlib

            r = subprocess.run(["diskutil", "info", "-plist", path], capture_output=True, timeout=5)
            if r.returncode == 0:
                info = plistlib.loads(r.stdout)
                # MediaSerialNumber is present for drives that report a hardware serial;
                # VolumeUUID is always present for formatted volumes as a reliable fallback.
                return info.get("MediaSerialNumber") or info.get("VolumeUUID")
        except Exception:
            pass
        return None
    else:
        try:
            src = subprocess.run(
                ["findmnt", "-n", "-o", "SOURCE", path],
                capture_output=True,
                text=True,
                timeout=5,
            )
            device = src.stdout.strip()
            if src.returncode != 0 or not device:
                return None
            # Try hardware serial from the block device
            serial_r = subprocess.run(
                ["lsblk", "-dno", "SERIAL", device],
                capture_output=True,
                text=True,
                timeout=5,
            )
            serial = serial_r.stdout.strip()
            if serial and serial.strip("0"):  # skip all-zero placeholder serials
                return serial
            # Fall back to filesystem UUID
            uuid_r = subprocess.run(
                ["lsblk", "-no", "UUID", device],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return uuid_r.stdout.strip() or None
        except Exception:
            return None


@router.get("/detect-volumes", response_model=list[VolumeEntry])
def detect_volumes() -> list[VolumeEntry]:
    """Return a list of mounted volumes suitable for use as a source path."""
    mount_types = _get_mount_types()
    results: list[VolumeEntry] = []

    def _make_entry(path: str, label: str) -> VolumeEntry:
        fs_type = mount_types.get(path, "")
        return VolumeEntry(
            path=path,
            label=label,
            serial_number=_serial_for_path(path),
            is_network_mount=fs_type in _NETWORK_FS_TYPES,
        )

    if sys.platform == "darwin":
        # Native macOS: real volumes live in /Volumes. Exclude symlinks — macOS
        # creates /Volumes/Macintosh HD as a symlink to / which is not a device.
        try:
            for name in sorted(os.listdir("/Volumes")):
                if name.startswith("."):
                    continue
                path = os.path.join("/Volumes", name)
                if os.path.isdir(path) and not os.path.islink(path):
                    results.append(_make_entry(path, name))
        except OSError:
            pass
    else:
        # Linux (native or Docker on macOS with /Volumes bind-mounted).
        # Check /Volumes first: present when the Docker backend runs on a macOS
        # host and docker-compose maps /Volumes:/Volumes:ro into the container.
        if os.path.isdir("/Volumes"):
            try:
                for name in sorted(os.listdir("/Volumes")):
                    if name.startswith("."):
                        continue
                    path = os.path.join("/Volumes", name)
                    if os.path.isdir(path) and not os.path.islink(path):
                        results.append(_make_entry(path, name))
            except OSError:
                pass

        for base in ("/media", "/mnt"):
            try:
                for entry in sorted(os.listdir(base)):
                    if entry.startswith("."):
                        continue
                    candidate = os.path.join(base, entry)
                    if os.path.isdir(candidate):
                        sub = os.listdir(candidate)
                        if sub and any(os.path.isdir(os.path.join(candidate, s)) for s in sub):
                            for name in sorted(sub):
                                path = os.path.join(candidate, name)
                                if os.path.isdir(path):
                                    results.append(_make_entry(path, name))
                        else:
                            results.append(_make_entry(candidate, entry))
            except OSError:
                pass
    return results


@router.post("/{device_id}/photo", response_model=DeviceRead)
async def upload_device_photo(
    device_id: int,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
) -> Device:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in PHOTO_ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{content_type}'. Accepted: jpeg, png, webp.",
        )

    data = await file.read(PHOTO_MAX_BYTES + 1)
    if len(data) > PHOTO_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 5 MB size limit.")

    ext = PHOTO_ALLOWED_TYPES[content_type]
    settings.photos_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.photos_dir / f"device_{device_id}.{ext}"

    # Remove any previous photo file (different extension)
    if device.photo_path and device.photo_path != str(dest):
        with contextlib.suppress(OSError):
            os.remove(device.photo_path)

    dest.write_bytes(data)
    device.photo_path = str(dest)
    device.updated_at = datetime.utcnow()
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@router.get("/{device_id}/photo")
def get_device_photo(device_id: int, session: SessionDep) -> FileResponse:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.photo_path or not os.path.isfile(device.photo_path):
        raise HTTPException(status_code=404, detail="No photo for this device.")
    ext = device.photo_path.rsplit(".", 1)[-1].lower()
    media_type = {
        "jpg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }.get(ext, "application/octet-stream")
    return FileResponse(device.photo_path, media_type=media_type)


@router.delete("/{device_id}/photo", response_model=DeviceRead)
def delete_device_photo(device_id: int, session: SessionDep) -> Device:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.photo_path:
        with contextlib.suppress(OSError):
            os.remove(device.photo_path)
        device.photo_path = None
        device.updated_at = datetime.utcnow()
        session.add(device)
        session.commit()
        session.refresh(device)
    return device


@router.get("/{device_id}", response_model=DeviceRead)
def get_device(device_id: int, session: SessionDep):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.patch("/{device_id}", response_model=DeviceRead)
def update_device(device_id: int, body: DeviceUpdate, session: SessionDep):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    device.updated_at = datetime.utcnow()
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@router.delete("/{device_id}", status_code=204)
def delete_device(device_id: int, session: SessionDep):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    active_job = session.exec(
        select(Job).where(
            Job.device_id == device_id,
            Job.status.in_([JobStatus.pending, JobStatus.in_progress]),
        )
    ).first()
    if active_job:
        raise HTTPException(status_code=409, detail="Cannot delete device with an active job")

    # DuplicateGroups have no direct FK to Device — clean them up before cascade.
    file_entry_ids = {fe.id for fe in device.file_entries}
    dup_group_ids = {fe.duplicate_group_id for fe in device.file_entries if fe.duplicate_group_id is not None}
    for dg_id in dup_group_ids:
        dg = session.get(DuplicateGroup, dg_id)
        if dg is None:
            continue
        if {e.id for e in dg.entries}.issubset(file_entry_ids):
            session.delete(dg)
        elif dg.canonical_entry_id in file_entry_ids:
            dg.canonical_entry_id = None
            session.add(dg)
    session.flush()

    if device.photo_path:
        with contextlib.suppress(OSError):
            os.remove(device.photo_path)

    if device.staging_path:
        shutil.rmtree(device.staging_path, ignore_errors=True)

    session.delete(device)
    session.commit()


class JobTriggerRequest(BaseModel):
    job_type: JobType
    storage_target_id: int | None = None


@router.post("/{device_id}/jobs", status_code=202)
async def trigger_job(
    device_id: int, body: JobTriggerRequest, request: Request, session: SessionDep
):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    job_type = body.job_type
    prev_stage = device.stage  # capture before FSM mutation

    # Validate FSM transition
    if job_type == JobType.catalog:
        if device.stage not in RECATALOG_STAGES:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot start catalog from stage '{device.stage}' — "
                f"device must be in {[s.value for s in RECATALOG_STAGES]}",
            )
        device.stage = DeviceStage.cataloging
    elif job_type in JOB_START_TRANSITIONS:
        required_stage, next_stage = JOB_START_TRANSITIONS[job_type]
        if device.stage != required_stage:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot start {job_type.value} from stage '{device.stage}' — "
                f"device must be in '{required_stage.value}'",
            )
        device.stage = next_stage
    else:
        raise HTTPException(status_code=400, detail=f"Unknown job type: {job_type}")

    device.updated_at = datetime.utcnow()
    session.add(device)

    job = create_job(session, device_id=device_id, job_type=job_type)

    runner = get_runner(request)
    target_id = body.storage_target_id

    # Spawn background task — delegates to per-job-type handler in _job_runners.py
    async def _run() -> None:
        from app.api._job_runners import (
            run_catalog_handler,
            run_ios_extract_handler,
            run_migrate_handler,
            run_wipe_handler,
        )
        from app.core.database import get_session as _get_session
        from app.models.enums import JobStatus as _JS
        from app.models.job import Job as _Job

        try:
            if job_type == JobType.catalog:
                await run_catalog_handler(job.id or 0, device_id, prev_stage, runner, _get_session)
            elif job_type == JobType.ios_extract:
                await run_ios_extract_handler(
                    job.id or 0, device_id, prev_stage, runner, _get_session
                )
            elif job_type == JobType.migrate:
                await run_migrate_handler(
                    job.id or 0, device_id, prev_stage, target_id, runner, _get_session
                )
            elif job_type == JobType.wipe:
                await run_wipe_handler(job.id or 0, device_id, prev_stage, runner, _get_session)
        except Exception as e:
            with _get_session() as err_session:
                err_job = err_session.get(_Job, job.id)
                if err_job and err_job.status not in (_JS.completed, _JS.failed, _JS.cancelled):
                    err_job.status = _JS.failed
                    err_job.error_message = str(e)
                    err_job.completed_at = datetime.utcnow()
                    err_session.add(err_job)
                err_device = err_session.get(Device, device_id)
                if err_device:
                    err_device.stage = prev_stage
                    err_device.updated_at = datetime.utcnow()
                    err_session.add(err_device)
                err_session.commit()

    asyncio.create_task(_run())

    return {"job_id": job.id, "status": job.status}


@router.get("/{device_id}/jobs", response_model=list)
def list_device_jobs(device_id: int, session: SessionDep) -> list:
    from app.models.job import Job

    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return list(
        session.exec(
            select(Job).where(Job.device_id == device_id).order_by(Job.created_at.desc())  # type: ignore[attr-defined]
        ).all()
    )


@router.post("/{device_id}/clear-staging", response_model=DeviceRead)
def clear_staging(device_id: int, session: SessionDep) -> Device:
    import shutil

    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.staging_path:
        raise HTTPException(status_code=409, detail="Device has no staging directory")
    try:
        shutil.rmtree(device.staging_path, ignore_errors=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to remove staging dir: {exc}") from exc
    device.staging_path = None
    device.updated_at = datetime.utcnow()
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@router.post("/{device_id}/mark-wiped", response_model=DeviceRead)
def mark_wiped(device_id: int, session: SessionDep) -> Device:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.stage != DeviceStage.wiping:
        raise HTTPException(
            status_code=409,
            detail=f"Device is in stage '{device.stage}', not 'wiping'",
        )
    device.stage = DeviceStage.wiped
    device.updated_at = datetime.utcnow()
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@router.post("/{device_id}/mark-recycled", response_model=DeviceRead)
def mark_recycled(device_id: int, session: SessionDep) -> Device:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.stage != DeviceStage.wiped:
        raise HTTPException(
            status_code=409,
            detail=f"Device is in stage '{device.stage}', not 'wiped'",
        )
    device.stage = DeviceStage.recycled
    device.updated_at = datetime.utcnow()
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


# ── Storage type detection ────────────────────────────────────────────────────


def _detect_storage_type(block_device: str) -> StorageType:
    """Return hdd/ssd based on the block device, or unknown on failure."""
    if sys.platform == "darwin":
        try:
            import plistlib

            result = subprocess.run(
                ["diskutil", "info", "-plist", block_device],
                capture_output=True,
                timeout=10,
            )
            if result.returncode == 0:
                info = plistlib.loads(result.stdout)
                solid_state = info.get("SolidState")
                if solid_state is True:
                    return StorageType.ssd
                if solid_state is False:
                    return StorageType.hdd
        except Exception:
            pass
    else:
        try:
            dev_name = block_device.lstrip("/").split("/")[-1]  # /dev/sdb → sdb
            rotational = (
                subprocess.run(
                    ["cat", f"/sys/block/{dev_name}/queue/rotational"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                .stdout.strip()
            )
            if rotational == "0":
                return StorageType.ssd
            if rotational == "1":
                return StorageType.hdd
        except Exception:
            pass
    return StorageType.unknown


@router.post("/{device_id}/detect-storage", response_model=DeviceRead)
def detect_storage(device_id: int, session: SessionDep) -> Device:
    """Auto-detect whether the device's storage is SSD or HDD and save the result."""
    from app.engines.wipe import _resolve_block_device

    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.source_path:
        raise HTTPException(status_code=409, detail="Device has no source_path for detection")

    block_device = _resolve_block_device(device.source_path)
    storage_type = _detect_storage_type(block_device)

    device.storage_type = storage_type
    device.updated_at = datetime.utcnow()
    session.add(device)
    session.commit()
    session.refresh(device)
    return device
