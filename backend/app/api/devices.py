import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from sqlmodel import select

from app.core.deps import SessionDep, get_runner
from app.core.job_factory import create_job
from app.models.device import Device, DeviceCreate, DeviceRead, DeviceUpdate
from app.models.enums import DeviceStage, JobType

# Valid stage transitions triggered by starting a job
JOB_START_TRANSITIONS: dict[JobType, tuple[DeviceStage, DeviceStage]] = {
    JobType.catalog:     (DeviceStage.registered,  DeviceStage.cataloging),
    JobType.ios_extract: (DeviceStage.registered,  DeviceStage.cataloging),
    JobType.migrate:     (DeviceStage.analyzed,     DeviceStage.migrating),
    JobType.verify:      (DeviceStage.migrated,     DeviceStage.verifying),
    JobType.wipe:        (DeviceStage.verified,     DeviceStage.wiping),
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


class JobTriggerBody:
    def __init__(self, job_type: JobType):
        self.job_type = job_type


from pydantic import BaseModel


class JobTriggerRequest(BaseModel):
    job_type: JobType


@router.post("/{device_id}/jobs", status_code=202)
async def trigger_job(device_id: int, body: JobTriggerRequest, request: Request, session: SessionDep):
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

    # Spawn background task — import engines lazily to avoid circular deps
    async def _run():
        from app.core.database import get_session as _get_session
        from app.models.job import Job as _Job
        from app.models.enums import JobStatus as _JS
        try:
            if job_type == JobType.catalog:
                from app.engines.catalog import run_catalog
                with _get_session() as bg_session:
                    bg_device = bg_session.get(Device, device_id)
                    await run_catalog(job.id, bg_device, bg_session, runner)
                    # Only advance stage if job succeeded
                    with _get_session() as check_session:
                        finished_job = check_session.get(_Job, job.id)
                        success = finished_job and finished_job.status == _JS.completed
                    with _get_session() as upd_session:
                        upd_device = upd_session.get(Device, device_id)
                        if upd_device:
                            upd_device.stage = DeviceStage.cataloged if success else prev_stage
                            upd_device.updated_at = datetime.utcnow()
                            upd_session.add(upd_device)
                            upd_session.commit()
        except Exception as e:
            # Mark job failed and revert device stage
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
