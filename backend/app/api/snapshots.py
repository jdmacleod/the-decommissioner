import json

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel, select

from app.core.deps import SessionDep
from app.models.device import Device
from app.models.snapshot import Snapshot, SnapshotRead

router = APIRouter(prefix="/devices", tags=["snapshots"])


class VerifyDiff(SQLModel):
    discrepancy: bool
    catalog_count: int
    snapshot_count: int
    missing_paths: list[str]


@router.get("/{device_id}/snapshots", response_model=list[SnapshotRead])
def list_snapshots(device_id: int, session: SessionDep) -> list[Snapshot]:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return list(
        session.exec(
            select(Snapshot)
            .where(Snapshot.device_id == device_id)
            .order_by(Snapshot.taken_at.desc())  # type: ignore[attr-defined]
        ).all()
    )


@router.get("/{device_id}/verify-diff", response_model=VerifyDiff)
def get_verify_diff(device_id: int, session: SessionDep) -> VerifyDiff:
    """Return discrepancy data from the latest completed verify job for a device."""
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    from app.models.enums import JobStatus, JobType
    from app.models.job import Job

    job = session.exec(
        select(Job)
        .where(
            Job.device_id == device_id,
            Job.job_type == JobType.verify,
            Job.status == JobStatus.completed,
        )
        .order_by(Job.created_at.desc())  # type: ignore[attr-defined]
    ).first()

    if not job or not job.job_metadata:
        return VerifyDiff(discrepancy=False, catalog_count=0, snapshot_count=0, missing_paths=[])

    try:
        data = json.loads(job.job_metadata)
        return VerifyDiff(
            discrepancy=bool(data.get("discrepancy", False)),
            catalog_count=int(data.get("catalog_count", 0)),
            snapshot_count=int(data.get("snapshot_count", 0)),
            missing_paths=list(data.get("missing_paths", [])),
        )
    except (json.JSONDecodeError, KeyError, TypeError):
        return VerifyDiff(discrepancy=False, catalog_count=0, snapshot_count=0, missing_paths=[])
