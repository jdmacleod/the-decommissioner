"""
Background job handler functions, extracted from the trigger_job _run() closure.

Each handler runs one full job lifecycle: call the engine, check success, update
device stage. Two shared helpers — _job_ok and _set_stage — eliminate repeated
session-open / status-check / commit sequences.
"""

from datetime import datetime
from typing import Any

from app.models.device import Device
from app.models.enums import DeviceStage, JobStatus, JobType


def _job_ok(job_id: int, get_session: Any) -> bool:
    """Return True if the job completed successfully."""
    from app.models.job import Job

    with get_session() as s:
        j = s.get(Job, job_id)
        return bool(j and j.status == JobStatus.completed)


def _set_stage(device_id: int, stage: DeviceStage, get_session: Any) -> None:
    """Advance (or revert) device.stage in a fresh session."""
    with get_session() as s:
        d = s.get(Device, device_id)
        if d:
            d.stage = stage
            d.updated_at = datetime.utcnow()
            s.add(d)
            s.commit()


async def run_catalog_handler(
    job_id: int,
    device_id: int,
    prev_stage: DeviceStage,
    runner: Any,
    get_session: Any,
) -> None:
    from app.engines.catalog import run_catalog

    with get_session() as bg_session:
        bg_device = bg_session.get(Device, device_id)
        await run_catalog(job_id, bg_device, bg_session, runner)

    stage = DeviceStage.cataloged if _job_ok(job_id, get_session) else prev_stage
    _set_stage(device_id, stage, get_session)


async def run_ios_extract_handler(
    job_id: int,
    device_id: int,
    prev_stage: DeviceStage,
    runner: Any,
    get_session: Any,
) -> None:
    from app.core.job_factory import create_job
    from app.engines.catalog import run_catalog
    from app.engines.ios import run_ios_extract

    with get_session() as bg_session:
        bg_device = bg_session.get(Device, device_id)
        await run_ios_extract(job_id, bg_device, bg_session, runner)

    if not _job_ok(job_id, get_session):
        _set_stage(device_id, prev_stage, get_session)
        return

    catalog_job = None
    with get_session() as cat_session:
        cat_device = cat_session.get(Device, device_id)
        catalog_job = create_job(cat_session, device_id, JobType.catalog)
        if cat_device:
            cat_device.stage = DeviceStage.cataloging
            cat_device.updated_at = datetime.utcnow()
            cat_session.add(cat_device)
            cat_session.commit()

    with get_session() as cat_bg:
        cat_device = cat_bg.get(Device, device_id)
        await run_catalog(catalog_job.id or 0, cat_device, cat_bg, runner)

    catalog_ok = _job_ok(catalog_job.id or 0, get_session)
    _set_stage(
        device_id,
        DeviceStage.cataloged if catalog_ok else DeviceStage.registered,
        get_session,
    )


async def run_migrate_handler(
    job_id: int,
    device_id: int,
    prev_stage: DeviceStage,
    target_id: int | None,
    runner: Any,
    get_session: Any,
) -> None:
    from sqlmodel import select

    from app.core.job_factory import create_job
    from app.engines.migrate import run_migrate
    from app.engines.verify import run_verify
    from app.models.storage_target import StorageTarget as _ST

    resolved_target_id: int | None = None
    with get_session() as bg_session:
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
        await run_migrate(job_id, bg_device, st, bg_session, runner)

    if not _job_ok(job_id, get_session):
        _set_stage(device_id, prev_stage, get_session)
        return

    _set_stage(device_id, DeviceStage.migrated, get_session)

    verify_job = None
    with get_session() as vs:
        verify_job = create_job(vs, device_id, JobType.verify)
        v_device = vs.get(Device, device_id)
        if v_device:
            v_device.stage = DeviceStage.verifying
            v_device.updated_at = datetime.utcnow()
            vs.add(v_device)
            vs.commit()

    with get_session() as verify_bg:
        v_target = verify_bg.get(_ST, resolved_target_id)
        v_device = verify_bg.get(Device, device_id)
        await run_verify(
            verify_job.id or 0,
            v_device,
            v_target,
            verify_bg,
            runner,  # type: ignore[arg-type]
        )

    verify_ok = _job_ok(verify_job.id or 0, get_session)
    _set_stage(
        device_id,
        DeviceStage.verified if verify_ok else DeviceStage.migrated,
        get_session,
    )


async def run_wipe_handler(
    job_id: int,
    device_id: int,
    prev_stage: DeviceStage,
    runner: Any,
    get_session: Any,
) -> None:
    from app.engines.wipe import APPLE_DEVICE_TYPES as _APPLE_TYPES
    from app.engines.wipe import run_wipe

    with get_session() as bg_session:
        bg_device = bg_session.get(Device, device_id)
        await run_wipe(job_id, bg_device, bg_session, runner)

    if not _job_ok(job_id, get_session):
        _set_stage(device_id, prev_stage, get_session)
        return

    # Apple devices: stay in wiping — user must click "Mark as Wiped"
    # Hardware devices: advance to wiped automatically
    with get_session() as s:
        d = s.get(Device, device_id)
        if d and d.device_type not in _APPLE_TYPES:
            d.stage = DeviceStage.wiped
            d.updated_at = datetime.utcnow()
            s.add(d)
            s.commit()
