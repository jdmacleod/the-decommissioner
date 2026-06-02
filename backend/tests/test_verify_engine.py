"""Tests for the verify engine (restic check wrapper)."""

import json
import subprocess
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session

from app.engines.verify import run_verify
from app.models.enums import FileStatus
from tests.conftest import make_device, make_job, make_snapshot, make_storage_target


@pytest.fixture(name="runner")
def runner_fixture(engine) -> object:
    from app.core.runner import SubprocessRunner

    @contextmanager
    def factory():
        with Session(engine) as s:
            yield s

    return SubprocessRunner(factory)


async def test_run_verify_marks_entries_verified(
    session: Session, tmp_path: Path, runner, monkeypatch
) -> None:
    from app.models.file_entry import FileEntry

    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)

    entry = FileEntry(
        device_id=device.id,
        path="/some/file.txt",
        relative_path="file.txt",
        size_bytes=100,
        sha256="abc",
        mtime=datetime.utcnow(),
        status=FileStatus.migrated,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)

    async def fake_run(job_id, cmd, **kwargs):
        yield "restic check OK\n"
        yield "no errors were found\n"

    monkeypatch.setattr(runner, "run", fake_run)

    ok_result = MagicMock(spec=subprocess.CompletedProcess)
    ok_result.returncode = 0
    ok_result.stdout = json.dumps([{"short_id": "abc12345", "time": "2024-01-01T00:00:00Z"}])

    with patch("app.engines.verify.subprocess.run", return_value=ok_result):
        await run_verify(job.id, device, target, session, runner)

    updated = session.get(FileEntry, entry.id)
    assert updated is not None
    assert updated.status == FileStatus.verified


async def test_run_verify_updates_snapshot_verified_at(
    session: Session, runner, monkeypatch
) -> None:
    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)
    snap = make_snapshot(session, device.id, job.id, target.id)

    assert snap.verified_at is None

    async def fake_run(job_id, cmd, **kwargs):
        yield "check passed\n"

    monkeypatch.setattr(runner, "run", fake_run)

    ok_result = MagicMock(spec=subprocess.CompletedProcess)
    ok_result.returncode = 0
    ok_result.stdout = json.dumps([{"short_id": "abc12345", "time": "2024-01-01T00:00:00Z"}])

    with patch("app.engines.verify.subprocess.run", return_value=ok_result):
        await run_verify(job.id, device, target, session, runner)

    session.expire_all()
    from app.models.snapshot import Snapshot

    updated_snap = session.get(Snapshot, snap.id)
    assert updated_snap is not None
    assert updated_snap.verified_at is not None


async def test_run_verify_snapshot_subprocess_fails_gracefully(
    session: Session, runner, monkeypatch
) -> None:
    from app.models.file_entry import FileEntry

    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)

    entry = FileEntry(
        device_id=device.id,
        path="/file.txt",
        relative_path="file.txt",
        size_bytes=50,
        sha256="xyz",
        mtime=datetime.utcnow(),
        status=FileStatus.migrated,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)

    async def fake_run(job_id, cmd, **kwargs):
        yield "check passed\n"

    monkeypatch.setattr(runner, "run", fake_run)

    fail_result = MagicMock(spec=subprocess.CompletedProcess)
    fail_result.returncode = 1
    fail_result.stdout = ""

    with patch("app.engines.verify.subprocess.run", return_value=fail_result):
        await run_verify(job.id, device, target, session, runner)

    # FileEntries should still be marked verified even if snapshot listing fails
    updated = session.get(FileEntry, entry.id)
    assert updated is not None
    assert updated.status == FileStatus.verified


async def test_run_verify_handles_subprocess_exception(
    session: Session, runner, monkeypatch
) -> None:
    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)

    async def fake_run(job_id, cmd, **kwargs):
        yield "check passed\n"

    monkeypatch.setattr(runner, "run", fake_run)

    with patch("app.engines.verify.subprocess.run", side_effect=OSError("not found")):
        # Should not raise
        await run_verify(job.id, device, target, session, runner)
