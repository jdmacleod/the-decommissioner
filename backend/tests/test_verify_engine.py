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


def _ls_result(paths: list[str]) -> MagicMock:
    """Build a mock restic ls --json result with the given file paths."""
    lines = "\n".join(
        json.dumps({"type": "file", "path": p, "name": p.split("/")[-1]}) for p in paths
    )
    r = MagicMock(spec=subprocess.CompletedProcess)
    r.returncode = 0
    r.stdout = lines
    return r


def _snapshots_result() -> MagicMock:
    r = MagicMock(spec=subprocess.CompletedProcess)
    r.returncode = 0
    r.stdout = json.dumps([{"short_id": "abc12345", "time": "2024-01-01T00:00:00Z"}])
    return r


async def test_run_verify_no_discrepancy_writes_metadata(
    session: Session, runner, monkeypatch
) -> None:
    from app.models.file_entry import FileEntry
    from app.models.job import Job

    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)
    make_snapshot(session, device.id, job.id, target.id)

    for fname in ("file1.txt", "file2.txt"):
        session.add(
            FileEntry(
                device_id=device.id,
                path=f"/source/{fname}",
                relative_path=fname,
                size_bytes=100,
                sha256="abc",
                mtime=datetime.utcnow(),
                status=FileStatus.migrated,
            )
        )
    session.commit()

    async def fake_run(job_id, cmd, **kwargs):
        yield "check passed\n"

    monkeypatch.setattr(runner, "run", fake_run)

    with patch(
        "app.engines.verify.subprocess.run",
        side_effect=[_snapshots_result(), _ls_result(["/source/file1.txt", "/source/file2.txt"])],
    ):
        await run_verify(job.id, device, target, session, runner)

    session.expire_all()
    job_row = session.get(Job, job.id)
    assert job_row is not None and job_row.job_metadata is not None
    data = json.loads(job_row.job_metadata)
    assert data["discrepancy"] is False
    assert data["catalog_count"] == 2
    assert data["snapshot_count"] == 2
    assert data["missing_paths"] == []


async def test_run_verify_discrepancy_writes_missing_paths(
    session: Session, runner, monkeypatch
) -> None:
    from app.models.file_entry import FileEntry
    from app.models.job import Job

    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)
    make_snapshot(session, device.id, job.id, target.id)

    for fname in ("keep.txt", "missing.txt"):
        session.add(
            FileEntry(
                device_id=device.id,
                path=f"/source/{fname}",
                relative_path=fname,
                size_bytes=100,
                sha256="abc",
                mtime=datetime.utcnow(),
                status=FileStatus.migrated,
            )
        )
    session.commit()

    async def fake_run(job_id, cmd, **kwargs):
        yield "check passed\n"

    monkeypatch.setattr(runner, "run", fake_run)

    # restic ls only returns keep.txt — missing.txt is absent from snapshot
    with patch(
        "app.engines.verify.subprocess.run",
        side_effect=[_snapshots_result(), _ls_result(["/source/keep.txt"])],
    ):
        await run_verify(job.id, device, target, session, runner)

    session.expire_all()
    job_row = session.get(Job, job.id)
    assert job_row is not None and job_row.job_metadata is not None
    data = json.loads(job_row.job_metadata)
    assert data["discrepancy"] is True
    assert data["catalog_count"] == 2
    assert data["snapshot_count"] == 1
    assert data["missing_paths"] == ["/source/missing.txt"]


async def test_run_verify_ls_failure_assumes_no_discrepancy(
    session: Session, runner, monkeypatch
) -> None:
    from app.models.file_entry import FileEntry
    from app.models.job import Job

    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)
    make_snapshot(session, device.id, job.id, target.id)

    session.add(
        FileEntry(
            device_id=device.id,
            path="/source/file.txt",
            relative_path="file.txt",
            size_bytes=100,
            sha256="abc",
            mtime=datetime.utcnow(),
            status=FileStatus.migrated,
        )
    )
    session.commit()

    async def fake_run(job_id, cmd, **kwargs):
        yield "check passed\n"

    monkeypatch.setattr(runner, "run", fake_run)

    ls_fail = MagicMock(spec=subprocess.CompletedProcess)
    ls_fail.returncode = 1
    ls_fail.stdout = ""

    with patch(
        "app.engines.verify.subprocess.run",
        side_effect=[_snapshots_result(), ls_fail],
    ):
        await run_verify(job.id, device, target, session, runner)

    session.expire_all()
    job_row = session.get(Job, job.id)
    assert job_row is not None and job_row.job_metadata is not None
    data = json.loads(job_row.job_metadata)
    assert data["discrepancy"] is False
    assert data["missing_paths"] == []
