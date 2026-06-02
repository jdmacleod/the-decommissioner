from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app.core.deps import SessionDep
from app.models.device import Device
from app.models.snapshot import Snapshot, SnapshotRead

router = APIRouter(prefix="/devices", tags=["snapshots"])


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
