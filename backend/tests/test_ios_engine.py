"""Tests for the iOS extraction engine (ios.py)."""

import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session

from app.engines.ios import _unmount, detect_ios_device, run_ios_extract
from app.models.enums import JobStatus, JobType
from tests.conftest import make_device, make_job

# ── detect_ios_device ─────────────────────────────────────────────────────────


def test_detect_ios_available():
    name_result = MagicMock(spec=subprocess.CompletedProcess)
    name_result.returncode = 0
    name_result.stdout = "Jason's iPhone\n"

    serial_result = MagicMock(spec=subprocess.CompletedProcess)
    serial_result.returncode = 0
    serial_result.stdout = "ABC123DEF456\n"

    with patch("subprocess.run", side_effect=[name_result, serial_result]):
        result = detect_ios_device()

    assert result["available"] is True
    assert result["name"] == "Jason's iPhone"
    assert result["serial"] == "ABC123DEF456"


def test_detect_ios_nonzero_exit():
    fail_result = MagicMock(spec=subprocess.CompletedProcess)
    fail_result.returncode = 1

    with patch("subprocess.run", return_value=fail_result):
        result = detect_ios_device()

    assert result["available"] is False
    assert result["name"] is None


def test_detect_ios_command_not_found():
    with patch("subprocess.run", side_effect=FileNotFoundError("ideviceinfo not found")):
        result = detect_ios_device()

    assert result["available"] is False


def test_detect_ios_generic_exception():
    with patch("subprocess.run", side_effect=RuntimeError("timeout")):
        result = detect_ios_device()

    assert result["available"] is False


def test_detect_ios_serial_fails_gracefully():
    name_result = MagicMock(spec=subprocess.CompletedProcess)
    name_result.returncode = 0
    name_result.stdout = "My iPad\n"

    serial_result = MagicMock(spec=subprocess.CompletedProcess)
    serial_result.returncode = 1

    with patch("subprocess.run", side_effect=[name_result, serial_result]):
        result = detect_ios_device()

    assert result["available"] is True
    assert result["name"] == "My iPad"
    assert result["serial"] is None


# ── _unmount ──────────────────────────────────────────────────────────────────


def test_unmount_darwin(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("sys.platform", "darwin")
    called = []

    def fake_run(cmd, **kwargs):
        called.append(cmd)
        return MagicMock(returncode=0)

    with patch("subprocess.run", side_effect=fake_run):
        _unmount(tmp_path)

    assert called[0][0] == "diskutil"
    assert "unmount" in called[0]


def test_unmount_linux(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("sys.platform", "linux")
    called = []

    def fake_run(cmd, **kwargs):
        called.append(cmd)
        return MagicMock(returncode=0)

    with patch("subprocess.run", side_effect=fake_run):
        _unmount(tmp_path)

    assert called[0][0] == "umount"


# ── run_ios_extract ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ios_extract_mount_failure(session: Session, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import app.core.config as cfg

    monkeypatch.setattr(cfg, "settings", cfg.Settings())

    device = make_device(session, device_type="iphone", stage="registered", source_path=None)
    job = make_job(session, device.id, job_type=JobType.ios_extract)

    fail_mount = MagicMock(spec=subprocess.CompletedProcess)
    fail_mount.returncode = 1
    fail_mount.stderr = b"No device found"

    with (
        patch("subprocess.run", return_value=fail_mount),
        pytest.raises(RuntimeError, match="ifuse mount failed"),
    ):
        await run_ios_extract(job.id, device, session, MagicMock())


@pytest.mark.asyncio
async def test_ios_extract_success_sets_staging_path(session: Session, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import app.core.config as cfg

    monkeypatch.setattr(cfg, "settings", cfg.Settings())
    import app.engines.ios as ios_module

    monkeypatch.setattr(ios_module, "settings", cfg.Settings())

    device = make_device(session, device_type="iphone", stage="registered", source_path=None)
    job = make_job(session, device.id, job_type=JobType.ios_extract, status=JobStatus.completed)

    ok_mount = MagicMock(spec=subprocess.CompletedProcess)
    ok_mount.returncode = 0

    async def fake_run(job_id, cmd, **kwargs):
        return
        yield  # make it an async generator

    runner = MagicMock()
    runner.run = fake_run

    with patch("subprocess.run", return_value=ok_mount):
        await run_ios_extract(job.id, device, session, runner)

    session.refresh(device)
    assert device.staging_path is not None
    assert "files" in device.staging_path


@pytest.mark.asyncio
async def test_ios_extract_skips_staging_path_when_job_failed(
    session: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import app.core.config as cfg

    monkeypatch.setattr(cfg, "settings", cfg.Settings())
    import app.engines.ios as ios_module

    monkeypatch.setattr(ios_module, "settings", cfg.Settings())

    device = make_device(session, device_type="iphone", stage="registered", source_path=None)
    # Job starts as pending — runner will not mark completed since fake_run doesn't call _set_status
    job = make_job(session, device.id, job_type=JobType.ios_extract, status=JobStatus.failed)

    ok_mount = MagicMock(spec=subprocess.CompletedProcess)
    ok_mount.returncode = 0

    async def fake_run(job_id, cmd, **kwargs):
        return
        yield

    runner = MagicMock()
    runner.run = fake_run

    with patch("subprocess.run", return_value=ok_mount):
        await run_ios_extract(job.id, device, session, runner)

    session.refresh(device)
    assert device.staging_path is None
