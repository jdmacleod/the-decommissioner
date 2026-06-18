"""Tests for the migrate engine (restic backup wrapper)."""

import json
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.engines.migrate import _compute_eta, _parse_backup_summary, run_migrate
from app.models.enums import DeviceStage, FileStatus, JobStatus
from tests.conftest import make_device, make_job, make_storage_target


@pytest.fixture(name="source_dir")
def source_dir_fixture(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "file1.txt").write_text("hello")
    (source / "file2.txt").write_text("world")
    return source


@pytest.fixture(name="runner")
def runner_fixture(engine, tmp_data_dir) -> object:
    from contextlib import contextmanager

    from sqlmodel import Session as _Session

    from app.core.runner import SubprocessRunner

    @contextmanager
    def factory():
        with _Session(engine) as s:
            yield s

    return SubprocessRunner(factory)


# ── _compute_eta ────────────────────────────────────────────────────────────


def test_compute_eta_zero_elapsed() -> None:
    assert _compute_eta(500_000, 1_000_000, 0.0) is None


def test_compute_eta_zero_bytes_done() -> None:
    assert _compute_eta(0, 1_000_000, 60.0) is None


def test_compute_eta_zero_total_bytes() -> None:
    assert _compute_eta(500_000, 0, 60.0) is None


def test_compute_eta_normal() -> None:
    # 500 KB done in 60s → throughput 500 KB/s → 500 KB remaining → ~60s ETA
    result = _compute_eta(500_000, 1_000_000, 60.0)
    assert result == 60


# ── _parse_backup_summary ────────────────────────────────────────────────────


def test_parse_summary_extracts_fields() -> None:
    summary = {
        "message_type": "summary",
        "snapshot_id": "abcdef1234567890",
        "files_new": 10,
        "files_changed": 5,
        "files_unmodified": 3,
        "total_bytes_processed": 1024,
        "data_added": 512,
    }
    lines = ["Scanning...\n", json.dumps(summary) + "\n"]
    sid, files, total, added = _parse_backup_summary(lines)
    assert sid == "abcdef12"
    assert files == 18
    assert total == 1024
    assert added == 512


def test_parse_summary_ignores_non_summary_json() -> None:
    progress = json.dumps({"message_type": "status", "percent_done": 0.5})
    summary = json.dumps(
        {
            "message_type": "summary",
            "snapshot_id": "ff00ff001234abcd",
            "files_new": 2,
            "files_changed": 0,
            "files_unmodified": 0,
            "total_bytes_processed": 100,
            "data_added": 100,
        }
    )
    lines = [progress + "\n", summary + "\n"]
    sid, files, _, _ = _parse_backup_summary(lines)
    assert sid == "ff00ff00"
    assert files == 2


def test_parse_summary_no_summary_line() -> None:
    lines = ["some output\n", "more output\n"]
    sid, files, total, added = _parse_backup_summary(lines)
    assert sid is None
    assert files == 0


def test_parse_summary_invalid_json_skipped() -> None:
    lines = [
        "{not valid json}\n",
        '{"message_type":"summary","snapshot_id":"a1b2c3d4e5f6abcd","files_new":0,"files_changed":0,"files_unmodified":0,"total_bytes_processed":0,"data_added":0}\n',
    ]
    sid, _, _, _ = _parse_backup_summary(lines)
    assert sid == "a1b2c3d4"


# ── run_migrate integration ──────────────────────────────────────────────────


async def test_run_migrate_inserts_snapshot_and_updates_entries(
    session: Session, source_dir: Path, runner, monkeypatch
) -> None:
    from app.models.file_entry import FileEntry

    device = make_device(session, source_path=str(source_dir), stage=DeviceStage.analyzed)
    job = make_job(session, device.id, status=JobStatus.pending)
    target = make_storage_target(session, path="/tmp/test-repo")

    # Pre-populate file entries with keep status
    entry = FileEntry(
        device_id=device.id,
        path=str(source_dir / "file1.txt"),
        relative_path="file1.txt",
        size_bytes=5,
        sha256="abc123",
        mtime=__import__("datetime").datetime.utcnow(),
        status=FileStatus.keep,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)

    summary_line = json.dumps(
        {
            "message_type": "summary",
            "snapshot_id": "deadbeef12345678",
            "files_new": 2,
            "files_changed": 0,
            "files_unmodified": 0,
            "total_bytes_processed": 1024,
            "data_added": 1024,
        }
    )

    async def fake_run(job_id, cmd, **kwargs):
        yield "Starting backup...\n"
        yield summary_line + "\n"

    monkeypatch.setattr(runner, "run", fake_run)

    await run_migrate(job.id, device, target, session, runner)

    from app.models.snapshot import Snapshot

    snaps = session.exec(select(Snapshot)).all()
    assert len(snaps) == 1
    assert snaps[0].restic_snapshot_id == "deadbeef"
    assert snaps[0].file_count == 2
    assert snaps[0].total_bytes == 1024

    updated_entry = session.get(FileEntry, entry.id)
    assert updated_entry is not None
    assert updated_entry.status == FileStatus.migrated
    assert updated_entry.restic_snapshot_id == "deadbeef"


async def test_run_migrate_no_snapshot_id_skips_insert(
    session: Session, source_dir: Path, runner, monkeypatch
) -> None:
    device = make_device(session, source_path=str(source_dir))
    job = make_job(session, device.id)
    target = make_storage_target(session)

    async def fake_run(job_id, cmd, **kwargs):
        yield "Error: repo not found\n"

    monkeypatch.setattr(runner, "run", fake_run)

    await run_migrate(job.id, device, target, session, runner)

    from app.models.snapshot import Snapshot

    assert session.exec(select(Snapshot)).first() is None


async def test_run_migrate_emits_progress_for_status_lines(
    session: Session, source_dir: Path, runner, monkeypatch
) -> None:
    device = make_device(session, source_path=str(source_dir))
    job = make_job(session, device.id)
    target = make_storage_target(session)

    status_line = json.dumps(
        {
            "message_type": "status",
            "percent_done": 0.5,
            "files_done": 5,
            "total_files": 10,
            "bytes_done": 512,
            "total_bytes": 1024,
        }
    )
    summary_line = json.dumps(
        {
            "message_type": "summary",
            "snapshot_id": "aabbccdd11223344",
            "files_new": 10,
            "files_changed": 0,
            "files_unmodified": 0,
            "total_bytes_processed": 1024,
            "data_added": 1024,
        }
    )

    progress_calls: list[dict] = []

    async def fake_emit(job_id: int, data: dict) -> None:
        progress_calls.append(data)

    monkeypatch.setattr(runner, "emit_progress", fake_emit)

    async def fake_run(job_id, cmd, **kwargs):
        yield status_line + "\n"
        yield summary_line + "\n"

    monkeypatch.setattr(runner, "run", fake_run)

    await run_migrate(job.id, device, target, session, runner)

    assert len(progress_calls) == 1
    assert progress_calls[0]["percent_done"] == 0.5
    assert progress_calls[0]["bytes_done"] == 512


async def test_run_migrate_raises_if_no_source(session: Session, runner) -> None:
    device = make_device(session, source_path=None)
    device.staging_path = None
    job = make_job(session, device.id)
    target = make_storage_target(session)

    with pytest.raises(ValueError, match="no source_path"):
        await run_migrate(job.id, device, target, session, runner)
