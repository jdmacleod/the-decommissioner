import json
import os
import subprocess
from datetime import datetime

from sqlmodel import Session, select

from app.core.runner import SubprocessRunner
from app.models.device import Device
from app.models.enums import FileStatus
from app.models.file_entry import FileEntry
from app.models.snapshot import Snapshot
from app.models.storage_target import StorageTarget


async def run_verify(
    job_id: int,
    device: Device,
    storage_target: StorageTarget,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    env: dict[str, str] = {}
    pwd_val = os.environ.get(storage_target.restic_password_env)
    if pwd_val:
        env[storage_target.restic_password_env] = pwd_val

    check_cmd = ["restic", "check", "--repo", storage_target.path]
    async for _ in runner.run(job_id, check_cmd, env=env):
        pass

    _update_snapshot_record(device, storage_target, env, session)

    entries = session.exec(
        select(FileEntry).where(
            FileEntry.device_id == device.id,
            FileEntry.status == FileStatus.migrated,
        )
    ).all()
    for entry in entries:
        entry.status = FileStatus.verified
        session.add(entry)

    session.commit()


def _update_snapshot_record(
    device: Device,
    storage_target: StorageTarget,
    env: dict[str, str],
    session: Session,
) -> None:
    """Run restic snapshots --json and update the Snapshot row's verified_at."""
    merged_env = {**os.environ, **env}
    try:
        result = subprocess.run(
            [
                "restic",
                "snapshots",
                "--repo",
                storage_target.path,
                "--tag",
                f"device-{device.id}",
                "--json",
            ],
            capture_output=True,
            text=True,
            env=merged_env,
            timeout=60,
        )
    except Exception:
        return

    if result.returncode != 0:
        return

    try:
        snapshots_data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return

    if not snapshots_data:
        return

    snap = session.exec(
        select(Snapshot).where(Snapshot.device_id == device.id).order_by(Snapshot.taken_at.desc())  # type: ignore[attr-defined]
    ).first()
    if snap:
        snap.verified_at = datetime.utcnow()
        session.add(snap)
