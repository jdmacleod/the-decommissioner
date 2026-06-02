import asyncio
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

    # Spawn background task — import engines lazily to avoid circular deps
    async def _run() -> None:
        from app.core.database import get_session as _get_session
        from app.models.enums import JobStatus as _JS
        from app.models.job import Job as _Job

        try:
            if job_type == JobType.catalog:
                from app.engines.catalog import run_catalog

                with _get_session() as bg_session:
                    bg_device = bg_session.get(Device, device_id)
                    await run_catalog(job.id or 0, bg_device, bg_session, runner)
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

            elif job_type == JobType.migrate:
                from app.engines.migrate import run_migrate
                from app.engines.verify import run_verify
                from app.models.storage_target import StorageTarget as _ST

                resolved_target_id: int | None = None
                with _get_session() as bg_session:
                    st = (
                        bg_session.get(_ST, target_id)
                        if target_id
                        else bg_session.exec(
                            select(_ST).where(_ST.is_default == True)  # noqa: E712
                        ).first()
                    )
                    if not st:
                        raise RuntimeError("No storage target configured. Add one in Settings.")
                    resolved_target_id = st.id
                    bg_device = bg_session.get(Device, device_id)
                    await run_migrate(job.id or 0, bg_device, st, bg_session, runner)

                with _get_session() as check_session:
                    finished_job = check_session.get(_Job, job.id)
                    migrate_ok = finished_job and finished_job.status == _JS.completed

                if migrate_ok:
                    with _get_session() as upd:
                        upd_device = upd.get(Device, device_id)
                        if upd_device:
                            upd_device.stage = DeviceStage.migrated
                            upd_device.updated_at = datetime.utcnow()
                            upd.add(upd_device)
                            upd.commit()

                    verify_job = None
                    with _get_session() as vs:
                        verify_job = create_job(vs, device_id, JobType.verify)
                        v_device = vs.get(Device, device_id)
                        if v_device:
                            v_device.stage = DeviceStage.verifying
                            v_device.updated_at = datetime.utcnow()
                            vs.add(v_device)
                            vs.commit()

                    with _get_session() as verify_bg:
                        v_target = verify_bg.get(_ST, resolved_target_id)
                        v_device = verify_bg.get(Device, device_id)
                        await run_verify(verify_job.id or 0, v_device, v_target, verify_bg, runner)  # type: ignore[arg-type]

                    with _get_session() as check_v:
                        finished_v = check_v.get(_Job, verify_job.id)
                        verify_ok = finished_v and finished_v.status == _JS.completed

                    with _get_session() as final_upd:
                        final_device = final_upd.get(Device, device_id)
                        if final_device:
                            final_device.stage = (
                                DeviceStage.verified if verify_ok else DeviceStage.migrated
                            )
                            final_device.updated_at = datetime.utcnow()
                            final_upd.add(final_device)
                            final_upd.commit()
                else:
                    with _get_session() as err_upd:
                        err_device = err_upd.get(Device, device_id)
                        if err_device:
                            err_device.stage = prev_stage
                            err_device.updated_at = datetime.utcnow()
                            err_upd.add(err_device)
                            err_upd.commit()

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
