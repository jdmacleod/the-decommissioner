import json
import re
import subprocess
import sys
from time import monotonic

from sqlmodel import Session

from app.core.runner import SubprocessRunner
from app.models.device import Device
from app.models.enums import DeviceType, JobStatus, StorageType
from app.models.job import Job

APPLE_DEVICE_TYPES = {DeviceType.mac, DeviceType.iphone, DeviceType.ipad, DeviceType.network_volume}
USB_DEVICE_TYPES = {DeviceType.usb_drive}

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
        "Sign out of Messages: Messages → Settings → iMessage → Sign Out",
        "Unpair Bluetooth accessories",
        "Erase Mac (Erase Assistant — Apple Silicon M1+ or Intel T2, macOS Monterey+): "
        "System Settings → General → Transfer or Reset → Erase All Content and Settings",
        "Older Intel Macs only (pre-T2 or macOS < Monterey): "
        "Restart into Recovery (⌘R at boot) → Disk Utility → Erase, then reinstall macOS",
        "Device shows Setup Assistant / Hello screen (confirms erasure complete)",
    ],
    DeviceType.network_volume: [
        "Backup complete and verified — all files accounted for in the restic snapshot",
        "Confirm the share owner has been notified and access is no longer needed",
        "Disconnect the share: Finder → right-click volume → Eject, or run `umount <path>`",
    ],
}

# SSD/flash erasure checklists — overwrite wipe is ineffective on SSDs.
_SSD_CHECKLIST_DARWIN = [
    "Verify backup is complete — all files accounted for in the restic snapshot",
    "Open Disk Utility (Applications → Utilities → Disk Utility)",
    "Select the drive in the sidebar (the top-level device, not an individual volume)",
    "Click Erase, choose a format (APFS or ExFAT), then click Erase",
    "macOS Disk Utility performs a cryptographic erase — all data is rendered irrecoverable",
    "Confirm the drive shows as empty / reformatted",
]

_SSD_CHECKLIST_LINUX = [
    "Verify backup is complete — all files accounted for in the restic snapshot",
    "Check ATA Secure Erase support: sudo hdparm -I <device> | grep -i security",
    "If supported — set a temporary password and erase: "
    "sudo hdparm --security-set-pass p <device> && sudo hdparm --security-erase p <device>",
    "If ATA Secure Erase is unsupported — single-pass overwrite: "
    "sudo dd if=/dev/urandom of=<device> bs=4M status=progress",
    "Confirm the drive shows no readable data: sudo hexdump -C <device> | head",
]

_USB_CHECKLIST_DARWIN = [
    "Verify backup is complete — all files accounted for in the restic snapshot",
    "USB flash drives do not support ATA Secure Erase — reformat to erase all data",
    "Open Disk Utility → select the drive → click Erase → choose ExFAT or FAT32 → click Erase",
    "Confirm the drive shows as empty / reformatted",
]

_USB_CHECKLIST_LINUX = [
    "Verify backup is complete — all files accounted for in the restic snapshot",
    "USB flash drives do not support ATA Secure Erase — reformat to erase all data",
    "Run: sudo wipefs -a <device>  OR  sudo mkfs.vfat <device>",
    "Confirm the drive shows as empty / reformatted",
]


async def run_wipe(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    if device.device_type in APPLE_DEVICE_TYPES:
        await _run_checklist_wipe(job_id, device, session, runner)
    elif device.device_type in USB_DEVICE_TYPES or device.storage_type == StorageType.ssd:
        await _run_ssd_checklist_wipe(job_id, device, session, runner)
    else:
        # hdd or unknown — overwrite path
        await _run_disk_wipe(job_id, device, session, runner)


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


async def _run_ssd_checklist_wipe(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    if device.device_type in USB_DEVICE_TYPES:
        items = _USB_CHECKLIST_DARWIN if sys.platform == "darwin" else _USB_CHECKLIST_LINUX
        method = "usb_flash_checklist"
    else:
        items = _SSD_CHECKLIST_DARWIN if sys.platform == "darwin" else _SSD_CHECKLIST_LINUX
        method = "ssd_checklist"

    checklist = [{"label": label, "done": False} for label in items]
    metadata = json.dumps({"method": method, "checklist_items": checklist})

    job = session.get(Job, job_id)
    if job:
        job.job_metadata = metadata
        session.add(job)
        session.commit()

    await runner._set_status(job_id, JobStatus.completed)


async def _run_disk_wipe(
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
        method = "diskutil secureErase (3 passes)"
        cmd = ["diskutil", "secureErase", "3", block_device]
    else:
        method = "nwipe DoD 5220.22-M (3 passes)"
        cmd = ["nwipe", "--autonuke", "--method=dod522022m", block_device]

    # Write metadata immediately so the frontend can display wipe details during the job.
    job = session.get(Job, job_id)
    if job:
        job.job_metadata = json.dumps({"method": method, "block_device": block_device})
        session.add(job)
        session.commit()

    start_time = monotonic()
    async for line in runner.run(job_id, cmd):
        m = re.search(r"(\d+)%", line)
        if m:
            pct = int(m.group(1))
            elapsed = monotonic() - start_time
            eta: int | None = None
            if pct > 0:
                eta = int(elapsed / (pct / 100) * (1 - pct / 100))
            await runner.emit_progress(job_id, {"percent": pct, "eta_seconds": eta})


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
