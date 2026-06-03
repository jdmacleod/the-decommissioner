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

    snap = _update_snapshot_record(device, storage_target, env, session)

    entries = session.exec(
        select(FileEntry).where(
            FileEntry.device_id == device.id,
            FileEntry.status == FileStatus.migrated,
        )
    ).all()

    catalog_count = len(entries)
    missing_paths: list[str] = []

    if snap:
        snapshot_paths = _list_snapshot_paths(snap.restic_snapshot_id, storage_target, env)
        if snapshot_paths is not None:
            snapshot_path_set = set(snapshot_paths)
            missing_paths = [e.path for e in entries if e.path not in snapshot_path_set]

    discrepancy = len(missing_paths) > 0
    snapshot_count = catalog_count - len(missing_paths)

    from app.models.job import Job

    job_row = session.get(Job, job_id)
    if job_row:
        job_row.job_metadata = json.dumps(
            {
                "discrepancy": discrepancy,
                "catalog_count": catalog_count,
                "snapshot_count": snapshot_count,
                "missing_paths": missing_paths,
            }
        )
        session.add(job_row)

    for entry in entries:
        entry.status = FileStatus.verified
        session.add(entry)

    session.commit()


def _list_snapshot_paths(
    snapshot_id: str,
    storage_target: StorageTarget,
    env: dict[str, str],
) -> list[str] | None:
    """Run restic ls <snapshot_id> --json and return file paths found in the snapshot."""
    merged_env = {**os.environ, **env}
    try:
        result = subprocess.run(
            ["restic", "ls", snapshot_id, "--repo", storage_target.path, "--json"],
            capture_output=True,
            text=True,
            env=merged_env,
            timeout=120,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    paths: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict) and obj.get("type") == "file":
                paths.append(obj["path"])
        except json.JSONDecodeError:
            continue
    return paths


def _update_snapshot_record(
    device: Device,
    storage_target: StorageTarget,
    env: dict[str, str],
    session: Session,
) -> "Snapshot | None":
    """Run restic snapshots --json, update the Snapshot row's verified_at, and return it."""
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
        return None

    if result.returncode != 0:
        return None

    try:
        snapshots_data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    if not snapshots_data:
        return None

    snap = session.exec(
        select(Snapshot).where(Snapshot.device_id == device.id).order_by(Snapshot.taken_at.desc())  # type: ignore[attr-defined]
    ).first()
    if snap:
        snap.verified_at = datetime.utcnow()
        session.add(snap)
        return snap
    return None
