import json
import subprocess
import sys

from sqlmodel import Session

from app.core.runner import SubprocessRunner
from app.models.device import Device
from app.models.enums import DeviceType, JobStatus
from app.models.job import Job

APPLE_DEVICE_TYPES = {DeviceType.mac, DeviceType.iphone, DeviceType.ipad}

APPLE_CHECKLIST: dict[DeviceType, list[str]] = {
    DeviceType.iphone: [
        "Back up complete (verified via this app)",
        "Unpair Apple Watch (if paired)",
        "Sign out of iCloud: Settings → [Your Name] → Sign Out",
        "Sign out of App Store & iTunes",
        "Disable Find My iPhone: Settings → [Your Name] → Find My → Find My iPhone → Off",
        "Erase All Content and Settings: Settings → General → Transfer or Reset iPhone → Erase",
        "Device shows Setup screen (confirms erasure complete)",
    ],
    DeviceType.ipad: [
        "Back up complete (verified via this app)",
        "Sign out of iCloud: Settings → [Your Name] → Sign Out",
        "Sign out of App Store & iTunes",
        "Disable Find My iPad: Settings → [Your Name] → Find My → Find My iPad → Off",
        "Erase All Content and Settings: Settings → General → Transfer or Reset iPad → Erase",
        "Device shows Setup screen (confirms erasure complete)",
    ],
    DeviceType.mac: [
        "Back up complete (verified via this app)",
        "Sign out of iCloud: System Settings → Apple ID → Sign Out",
        "Sign out of Messages: Messages → Preferences → iMessage → Sign Out",
        "Unpair Bluetooth accessories",
        "Erase Mac: System Settings → General → Transfer or Reset → Erase All Content",
        "Device shows Setup Assistant screen (confirms erasure complete)",
    ],
}


async def run_wipe(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    if device.device_type in APPLE_DEVICE_TYPES:
        await _run_checklist_wipe(job_id, device, session, runner)
    else:
        await _run_nwipe(job_id, device, session, runner)


async def _run_checklist_wipe(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    items = APPLE_CHECKLIST.get(device.device_type, [])
    checklist = [{"label": label, "done": False} for label in items]
    metadata = json.dumps({"method": "apple_checklist", "checklist_items": checklist})

    job = session.get(Job, job_id)
    if job:
        job.job_metadata = metadata
        session.add(job)
        session.commit()

    await runner._set_status(job_id, JobStatus.completed)


async def _run_nwipe(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    source = device.source_path
    if not source:
        raise ValueError("Device has no source_path to wipe")

    block_device = _resolve_block_device(source)

    if sys.platform == "darwin":
        cmd = ["diskutil", "secureErase", "3", block_device]
    else:
        cmd = ["nwipe", "--autonuke", "--method=dod522022m", block_device]

    async for _ in runner.run(job_id, cmd):
        pass

    job = session.get(Job, job_id)
    if job and job.status == JobStatus.completed:
        job.job_metadata = json.dumps({"method": "nwipe", "block_device": block_device})
        session.add(job)
        session.commit()


def _resolve_block_device(mount_point: str) -> str:
    if sys.platform == "darwin":
        try:
            import plistlib

            result = subprocess.run(
                ["diskutil", "info", "-plist", mount_point],
                capture_output=True,
                timeout=10,
            )
            if result.returncode == 0:
                info = plistlib.loads(result.stdout)
                return str(info.get("DeviceNode", mount_point))
        except Exception:
            pass
        return mount_point
    else:
        try:
            result = subprocess.run(
                ["lsblk", "--json", "--output", "NAME,MOUNTPOINT"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                found = _find_device_for_mount(data.get("blockdevices", []), mount_point)
                if found:
                    return f"/dev/{found}"
        except Exception:
            pass
        return mount_point


def _find_device_for_mount(devices: list[dict], mount_point: str) -> str | None:
    for dev in devices:
        if dev.get("mountpoint") == mount_point:
            return str(dev["name"])
        children: list[dict] = dev.get("children", []) or []
        found = _find_device_for_mount(children, mount_point)
        if found:
            return found
    return None
