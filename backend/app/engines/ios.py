import subprocess
import sys
from pathlib import Path

from sqlmodel import Session

from app.core.config import settings
from app.core.runner import SubprocessRunner
from app.models.device import Device
from app.models.enums import JobStatus
from app.models.job import Job


async def run_ios_extract(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    staging_dir = Path(settings.data_dir) / "staging" / f"device_{device.id}"
    mount_dir = staging_dir / "mount"
    copy_dir = staging_dir / "files"
    mount_dir.mkdir(parents=True, exist_ok=True)
    copy_dir.mkdir(parents=True, exist_ok=True)

    # Mount iOS filesystem via ifuse (silent — output not part of the SSE log)
    mount_result = subprocess.run(
        ["ifuse", str(mount_dir)],
        capture_output=True,
        timeout=30,
    )
    if mount_result.returncode != 0:
        error = mount_result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"ifuse mount failed: {error or 'device may need to be unlocked'}")

    try:
        # Sync files using rsync — logged via runner so user sees progress
        cmd = ["rsync", "-a", "--progress", f"{mount_dir}/", f"{copy_dir}/"]
        async for _ in runner.run(job_id, cmd):
            pass
    finally:
        _unmount(mount_dir)

    # Only update staging_path if rsync succeeded
    job = session.get(Job, job_id)
    if not (job and job.status == JobStatus.completed):
        return

    device.staging_path = str(copy_dir)
    session.add(device)
    session.commit()


def _unmount(mount_dir: Path) -> None:
    if sys.platform == "darwin":
        subprocess.run(["diskutil", "unmount", str(mount_dir)], capture_output=True)
    else:
        subprocess.run(["umount", str(mount_dir)], capture_output=True)


def detect_ios_device() -> dict:
    """Probe a connected iOS device via ideviceinfo. Returns name + serial if found."""
    try:
        name_result = subprocess.run(
            ["ideviceinfo", "-k", "DeviceName"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if name_result.returncode != 0:
            return {"available": False, "name": None, "serial": None}

        name = name_result.stdout.strip() or None

        serial_result = subprocess.run(
            ["ideviceinfo", "-k", "SerialNumber"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        serial = serial_result.stdout.strip() or None if serial_result.returncode == 0 else None

        return {"available": True, "name": name, "serial": serial}

    except FileNotFoundError:
        return {"available": False, "name": None, "serial": None}
    except Exception:
        return {"available": False, "name": None, "serial": None}
