import json
import os
from datetime import datetime
from time import monotonic

from sqlmodel import Session, select

from app.core.runner import SubprocessRunner
from app.models.device import Device
from app.models.enums import FileStatus
from app.models.file_entry import FileEntry
from app.models.snapshot import Snapshot
from app.models.storage_target import StorageTarget


def _compute_eta(bytes_done: int, total_bytes: int, elapsed_seconds: float) -> int | None:
    if elapsed_seconds == 0 or bytes_done == 0 or total_bytes == 0:
        return None
    throughput = bytes_done / elapsed_seconds
    return round((total_bytes - bytes_done) / throughput)


async def run_migrate(
    job_id: int,
    device: Device,
    storage_target: StorageTarget,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    source = device.source_path or device.staging_path
    if not source:
        raise ValueError("Device has no source_path or staging_path")

    tags = [f"device-{device.id}", str(device.device_type), "the-decommissioner"]
    cmd = ["restic", "backup", source, "--repo", storage_target.path, "--json"]
    for tag in tags:
        cmd.extend(["--tag", tag])

    env: dict[str, str] = {}
    pwd_val = os.environ.get(storage_target.restic_password_env)
    if pwd_val:
        env[storage_target.restic_password_env] = pwd_val

    raw_lines: list[str] = []
    start_time = monotonic()
    async for line in runner.run(job_id, cmd, env=env):
        raw_lines.append(line)
        stripped = line.strip()
        if stripped.startswith("{"):
            try:
                obj = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if obj.get("message_type") == "status":
                elapsed = monotonic() - start_time
                eta = _compute_eta(
                    int(obj.get("bytes_done", 0)),
                    int(obj.get("total_bytes", 0)),
                    elapsed,
                )
                await runner.emit_progress(
                    job_id,
                    {
                        "percent_done": obj.get("percent_done", 0),
                        "files_done": obj.get("files_done", 0),
                        "total_files": obj.get("total_files", 0),
                        "bytes_done": obj.get("bytes_done", 0),
                        "total_bytes": obj.get("total_bytes", 0),
                        "eta_seconds": eta,
                    },
                )

    snapshot_id, file_count, total_bytes, added_bytes = _parse_backup_summary(raw_lines)
    if not snapshot_id:
        return  # runner already marked job failed on non-zero exit

    snap = Snapshot(
        device_id=device.id or 0,
        job_id=job_id,
        storage_target_id=storage_target.id or 0,
        restic_snapshot_id=snapshot_id,
        file_count=file_count,
        total_bytes=total_bytes,
        added_bytes=added_bytes,
        tags=json.dumps(tags),
        taken_at=datetime.utcnow(),
    )
    session.add(snap)

    entries = session.exec(
        select(FileEntry).where(
            FileEntry.device_id == device.id,
            FileEntry.status == FileStatus.keep,
        )
    ).all()
    for entry in entries:
        entry.status = FileStatus.migrated
        entry.restic_snapshot_id = snapshot_id
        session.add(entry)

    session.commit()


def _parse_backup_summary(lines: list[str]) -> tuple[str | None, int, int, int]:
    """Extract snapshot ID and stats from restic --json backup output."""
    for line in lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("message_type") == "summary":
            sid = obj.get("snapshot_id", "")
            short_id = sid[:8] if sid else ""
            files = (
                obj.get("files_new", 0)
                + obj.get("files_changed", 0)
                + obj.get("files_unmodified", 0)
            )
            total = obj.get("total_bytes_processed", 0)
            added = obj.get("data_added", 0)
            return short_id, int(files), int(total), int(added)
    return None, 0, 0, 0
