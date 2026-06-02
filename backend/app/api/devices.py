import asyncio
import os
import sys
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import select

from app.core.deps import SessionDep, get_runner
from app.core.job_factory import create_job
from app.models.device import Device, DeviceCreate, DeviceRead, DeviceUpdate
from app.models.enums import DeviceStage, JobType

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


class VolumeEntry(BaseModel):
    path: str
    label: str


@router.get("/detect-volumes", response_model=list[VolumeEntry])
def detect_volumes() -> list[VolumeEntry]:
    """Return a list of mounted volumes suitable for use as a source path."""
    results: list[VolumeEntry] = []
    if sys.platform == "darwin":
        base = "/Volumes"
        try:
            for name in sorted(os.listdir(base)):
                if name.startswith("."):
                    continue
                path = os.path.join(base, name)
                if os.path.isdir(path):
                    results.append(VolumeEntry(path=path, label=name))
        except OSError:
            pass
    else:
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
                                    results.append(VolumeEntry(path=path, label=name))
                        else:
                            results.append(VolumeEntry(path=candidate, label=entry))
            except OSError:
                pass
    return results


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
