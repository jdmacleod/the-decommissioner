"""Tests for the wipe engine (wipe.py)."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session

from app.engines.wipe import (
    APPLE_DEVICE_TYPES,
    _find_device_for_mount,
    _resolve_block_device,
    _run_checklist_wipe,
    _run_disk_wipe,
    run_wipe,
)
from app.models.enums import DeviceType, JobStatus, JobType
from tests.conftest import make_device, make_job

# ── _find_device_for_mount ────────────────────────────────────────────────────


def test_find_device_for_mount_direct_match():
    devices = [{"name": "sda", "mountpoint": "/mnt/data", "children": []}]
    assert _find_device_for_mount(devices, "/mnt/data") == "sda"


def test_find_device_for_mount_nested():
    devices = [
        {
            "name": "sda",
            "mountpoint": None,
            "children": [{"name": "sda1", "mountpoint": "/mnt/data", "children": []}],
        }
    ]
    assert _find_device_for_mount(devices, "/mnt/data") == "sda1"


def test_find_device_for_mount_no_match():
    devices = [{"name": "sda", "mountpoint": "/other", "children": []}]
    assert _find_device_for_mount(devices, "/mnt/data") is None


# ── _resolve_block_device ─────────────────────────────────────────────────────


def test_resolve_block_device_fallback_on_exception(monkeypatch):
    monkeypatch.setattr("sys.platform", "linux")
    with patch("subprocess.run", side_effect=Exception("fail")):
        result = _resolve_block_device("/mnt/data")
    assert result == "/mnt/data"


def test_resolve_block_device_linux_success(monkeypatch):
    monkeypatch.setattr("sys.platform", "linux")
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = json.dumps(
        {"blockdevices": [{"name": "sdb", "mountpoint": "/mnt/data", "children": []}]}
    )
    with patch("subprocess.run", return_value=mock_result):
        result = _resolve_block_device("/mnt/data")
    assert result == "/dev/sdb"


def test_resolve_block_device_linux_no_match(monkeypatch):
    monkeypatch.setattr("sys.platform", "linux")
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = json.dumps({"blockdevices": []})
    with patch("subprocess.run", return_value=mock_result):
        result = _resolve_block_device("/mnt/data")
    assert result == "/mnt/data"


def test_resolve_block_device_darwin_success(monkeypatch):
    import plistlib

    monkeypatch.setattr("sys.platform", "darwin")
    plist_data = plistlib.dumps({"DeviceNode": "/dev/disk2"})
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = plist_data
    with patch("subprocess.run", return_value=mock_result):
        result = _resolve_block_device("/Volumes/USB")
    assert result == "/dev/disk2"


def test_resolve_block_device_darwin_fallback(monkeypatch):
    monkeypatch.setattr("sys.platform", "darwin")
    mock_result = MagicMock()
    mock_result.returncode = 1
    with patch("subprocess.run", return_value=mock_result):
        result = _resolve_block_device("/Volumes/USB")
    assert result == "/Volumes/USB"


# ── _run_checklist_wipe ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_checklist_wipe_writes_metadata(session: Session):
    device = make_device(session, device_type="iphone", stage="verified")
    job = make_job(session, device.id, job_type=JobType.wipe)

    runner = MagicMock()
    runner._set_status = AsyncMock()

    await _run_checklist_wipe(job.id, device, session, runner)

    session.refresh(job)
    assert job.job_metadata is not None
    meta = json.loads(job.job_metadata)
    assert meta["method"] == "apple_checklist"
    items = meta["checklist_items"]
    assert len(items) > 0
    assert all(not item["done"] for item in items)


@pytest.mark.asyncio
async def test_checklist_wipe_marks_completed(session: Session):
    device = make_device(session, device_type="mac", stage="verified")
    job = make_job(session, device.id, job_type=JobType.wipe)

    captured_status = []

    async def capture_status(job_id, status):
        captured_status.append(status)

    runner = MagicMock()
    runner._set_status = capture_status

    await _run_checklist_wipe(job.id, device, session, runner)
    assert JobStatus.completed in captured_status


# ── run_wipe dispatch ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_wipe_dispatches_to_checklist_for_apple(session: Session):
    device = make_device(session, device_type="iphone", stage="verified")
    job = make_job(session, device.id, job_type=JobType.wipe)

    dispatched = []

    async def fake_checklist(jid, dev, sess, runner):
        dispatched.append("checklist")

    async def fake_disk_wipe(jid, dev, sess, runner):
        dispatched.append("disk_wipe")

    with (
        patch("app.engines.wipe._run_checklist_wipe", fake_checklist),
        patch("app.engines.wipe._run_disk_wipe", fake_disk_wipe),
    ):
        await run_wipe(job.id, device, session, MagicMock())

    assert dispatched == ["checklist"]


@pytest.mark.asyncio
async def test_run_wipe_dispatches_to_disk_wipe_for_hdd(session: Session):
    device = make_device(
        session, device_type="hard_drive", stage="verified", source_path="/tmp/drive"
    )
    job = make_job(session, device.id, job_type=JobType.wipe)

    dispatched = []

    async def fake_checklist(jid, dev, sess, runner):
        dispatched.append("checklist")

    async def fake_disk_wipe(jid, dev, sess, runner):
        dispatched.append("disk_wipe")

    with (
        patch("app.engines.wipe._run_checklist_wipe", fake_checklist),
        patch("app.engines.wipe._run_disk_wipe", fake_disk_wipe),
    ):
        await run_wipe(job.id, device, session, MagicMock())

    assert dispatched == ["disk_wipe"]


# ── _run_nwipe ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_disk_wipe_raises_when_no_source_path(session: Session):
    device = make_device(session, device_type="hard_drive", stage="verified", source_path=None)
    job = make_job(session, device.id, job_type=JobType.wipe)
    device.source_path = None

    with pytest.raises(ValueError, match="no source_path"):
        await _run_disk_wipe(job.id, device, session, MagicMock())


@pytest.mark.asyncio
async def test_disk_wipe_calls_nwipe_on_linux(session: Session, monkeypatch):
    monkeypatch.setattr("sys.platform", "linux")
    device = make_device(session, device_type="hard_drive", source_path="/mnt/drive")
    job = make_job(session, device.id, job_type=JobType.wipe)

    called_cmds = []

    async def fake_run(job_id, cmd, **kwargs):
        called_cmds.append(cmd)
        return
        yield  # make it an async generator

    mock_lsblk = MagicMock()
    mock_lsblk.returncode = 0
    mock_lsblk.stdout = json.dumps({"blockdevices": []})

    runner = MagicMock()
    runner.run = fake_run

    with patch("subprocess.run", return_value=mock_lsblk):
        await _run_disk_wipe(job.id, device, session, runner)

    assert len(called_cmds) == 1
    assert called_cmds[0][0] == "nwipe"


@pytest.mark.asyncio
async def test_disk_wipe_calls_diskutil_on_macos(session: Session, monkeypatch):
    import plistlib

    monkeypatch.setattr("sys.platform", "darwin")
    device = make_device(session, device_type="hard_drive", source_path="/Volumes/USB")
    job = make_job(session, device.id, job_type=JobType.wipe)

    called_cmds = []

    async def fake_run(job_id, cmd, **kwargs):
        called_cmds.append(cmd)
        return
        yield  # make it an async generator

    plist_data = plistlib.dumps({"DeviceNode": "/dev/disk2"})
    mock_diskutil = MagicMock()
    mock_diskutil.returncode = 0
    mock_diskutil.stdout = plist_data

    runner = MagicMock()
    runner.run = fake_run

    with patch("subprocess.run", return_value=mock_diskutil):
        await _run_disk_wipe(job.id, device, session, runner)

    assert len(called_cmds) == 1
    assert called_cmds[0][0] == "diskutil"


# ── APPLE_DEVICE_TYPES constant ───────────────────────────────────────────────


def test_apple_device_types_contains_expected():
    assert DeviceType.mac in APPLE_DEVICE_TYPES
    assert DeviceType.iphone in APPLE_DEVICE_TYPES
    assert DeviceType.ipad in APPLE_DEVICE_TYPES
    assert DeviceType.hard_drive not in APPLE_DEVICE_TYPES
    assert DeviceType.network_volume in APPLE_DEVICE_TYPES


# ── network_volume wipe ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_network_volume_dispatches_to_checklist(session: Session):
    device = make_device(
        session, device_type="network_volume", stage="verified", source_path="/Volumes/MyShare"
    )
    job = make_job(session, device.id, job_type=JobType.wipe)

    dispatched = []

    async def fake_checklist(jid, dev, sess, runner):
        dispatched.append("checklist")

    async def fake_disk_wipe(jid, dev, sess, runner):
        dispatched.append("disk_wipe")

    with (
        patch("app.engines.wipe._run_checklist_wipe", fake_checklist),
        patch("app.engines.wipe._run_disk_wipe", fake_disk_wipe),
    ):
        await run_wipe(job.id, device, session, MagicMock())

    assert dispatched == ["checklist"]


@pytest.mark.asyncio
async def test_network_volume_checklist_has_three_items(session: Session):
    from app.engines.wipe import APPLE_CHECKLIST

    device = make_device(
        session, device_type="network_volume", stage="verified", source_path="/Volumes/MyShare"
    )
    job = make_job(session, device.id, job_type=JobType.wipe)

    runner = MagicMock()
    runner._set_status = AsyncMock()

    await _run_checklist_wipe(job.id, device, session, runner)

    session.refresh(job)
    assert job.job_metadata is not None
    meta = json.loads(job.job_metadata)
    assert meta["method"] == "apple_checklist"
    items = meta["checklist_items"]
    assert len(items) == len(APPLE_CHECKLIST[DeviceType.network_volume])
    assert all(not item["done"] for item in items)


@pytest.mark.asyncio
async def test_network_volume_checklist_content(session: Session):
    device = make_device(
        session, device_type="network_volume", stage="verified", source_path="/Volumes/MyShare"
    )
    job = make_job(session, device.id, job_type=JobType.wipe)

    runner = MagicMock()
    runner._set_status = AsyncMock()

    await _run_checklist_wipe(job.id, device, session, runner)

    session.refresh(job)
    meta = json.loads(job.job_metadata)
    labels = [item["label"] for item in meta["checklist_items"]]
    assert any("backup" in label.lower() for label in labels)
    assert any(
        "disconnect" in label.lower() or "eject" in label.lower() or "umount" in label.lower()
        for label in labels
    )
