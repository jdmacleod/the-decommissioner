"""Tests for the catalog engine: file enumeration, hashing, duplicate detection."""

import hashlib
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session, select

from app.engines.catalog import (
    _build_duplicate_groups_from_hashes,
    _sha256_file,
    run_catalog,
)
from app.models.duplicate_group import DuplicateGroup
from app.models.enums import FileStatus
from app.models.file_entry import FileEntry
from tests.conftest import make_device, make_job


@pytest.fixture
def source_dir(tmp_path: Path) -> Path:
    """A temp directory with a few files, including two duplicates."""
    src = tmp_path / "source"
    src.mkdir()
    (src / "unique.txt").write_text("unique content here")
    (src / "dup_a.txt").write_text("duplicate content")
    (src / "dup_b.txt").write_text("duplicate content")
    sub = src / "subdir"
    sub.mkdir()
    (sub / "nested.txt").write_text("nested")
    return src


@pytest.fixture
def runner(engine: Any, tmp_data_dir: Path) -> Any:
    from contextlib import contextmanager

    from app.core.runner import SubprocessRunner

    @contextmanager  # type: ignore[misc]
    def session_factory() -> Any:
        with Session(engine) as s:
            yield s

    return SubprocessRunner(session_factory)


async def test_run_catalog_enumerates_all_files(
    session: Session, source_dir: Path, runner: Any
) -> None:
    d = make_device(session, source_path=str(source_dir))
    j = make_job(session, d.id)

    await run_catalog(j.id, d, session, runner)

    entries = session.exec(select(FileEntry).where(FileEntry.device_id == d.id)).all()
    assert len(entries) == 4  # unique, dup_a, dup_b, nested


async def test_run_catalog_hashes_files(
    session: Session, source_dir: Path, runner: Any, monkeypatch: Any
) -> None:
    import shutil as shutil_mod

    monkeypatch.setattr(shutil_mod, "which", lambda name: None)

    d = make_device(session, source_path=str(source_dir))
    j = make_job(session, d.id)

    await run_catalog(j.id, d, session, runner)

    entries = session.exec(select(FileEntry).where(FileEntry.device_id == d.id)).all()
    # All entries should have a non-empty SHA256 (python fallback)
    assert all(e.sha256 for e in entries)


async def test_run_catalog_detects_duplicates(
    session: Session, source_dir: Path, runner: Any, monkeypatch: Any
) -> None:
    import shutil as shutil_mod

    monkeypatch.setattr(shutil_mod, "which", lambda name: None)

    d = make_device(session, source_path=str(source_dir))
    j = make_job(session, d.id)

    await run_catalog(j.id, d, session, runner)

    groups = session.exec(select(DuplicateGroup)).all()
    assert len(groups) == 1  # one duplicate pair
    assert groups[0].total_size_bytes > 0


async def test_run_catalog_job_status_completed(
    session: Session, source_dir: Path, runner: Any, monkeypatch: Any
) -> None:
    import shutil as shutil_mod

    from app.models.enums import JobStatus

    monkeypatch.setattr(shutil_mod, "which", lambda name: None)

    d = make_device(session, source_path=str(source_dir))
    j = make_job(session, d.id)

    await run_catalog(j.id, d, session, runner)

    session.refresh(j)
    assert j.status == JobStatus.completed


async def test_run_catalog_recatalog_replaces_entries(
    session: Session, source_dir: Path, runner: Any
) -> None:
    d = make_device(session, source_path=str(source_dir))
    j1 = make_job(session, d.id)
    await run_catalog(j1.id, d, session, runner)

    # Re-catalog with same source — should not double entries
    session.refresh(d)
    j2 = make_job(session, d.id)
    await run_catalog(j2.id, d, session, runner)

    entries = session.exec(select(FileEntry).where(FileEntry.device_id == d.id)).all()
    assert len(entries) == 4


async def test_run_catalog_no_source_path(session: Session, runner: Any) -> None:
    d = make_device(session, source_path=None)
    d.source_path = None
    session.add(d)
    session.commit()
    j = make_job(session, d.id)

    await run_catalog(j.id, d, session, runner)

    from app.models.enums import JobStatus

    session.refresh(j)
    assert j.status == JobStatus.failed


async def test_run_catalog_with_czkawka(
    session: Session, source_dir: Path, runner: Any, monkeypatch: Any
) -> None:
    """Test the czkawka_cli path by mocking shutil.which and runner.run."""
    import json
    import shutil as shutil_mod

    monkeypatch.setattr(
        shutil_mod, "which", lambda name: "/usr/bin/czkawka_cli" if name == "czkawka_cli" else None
    )

    dup_a = str(source_dir / "dup_a.txt")
    dup_b = str(source_dir / "dup_b.txt")
    size = (source_dir / "dup_a.txt").stat().st_size
    # czkawka >=11 JSON format: dict keyed by file size, value is list of groups
    czkawka_json = json.dumps(
        {
            str(size): [
                [
                    {"path": dup_a, "size": size, "hash": "deadbeef" * 8, "modified_date": 0},
                    {"path": dup_b, "size": size, "hash": "deadbeef" * 8, "modified_date": 0},
                ]
            ]
        }
    )

    async def fake_run(job_id: int, cmd: list, **kwargs: Any):
        # Write JSON to the output file path specified in cmd
        out_idx = cmd.index("--compact-file-to-save")
        with open(cmd[out_idx + 1], "w") as fh:
            fh.write(czkawka_json)
        yield "Scanning...\n"

    monkeypatch.setattr(runner, "run", fake_run)

    d = make_device(session, source_path=str(source_dir))
    j = make_job(session, d.id)

    await run_catalog(j.id, d, session, runner)

    groups = session.exec(select(DuplicateGroup)).all()
    assert len(groups) == 1
    assert groups[0].content_hash == "deadbeef" * 8


def test_sha256_file(tmp_path: Path) -> None:
    f = tmp_path / "test.txt"
    f.write_bytes(b"hello world")
    expected = hashlib.sha256(b"hello world").hexdigest()
    assert _sha256_file(str(f)) == expected


def test_build_duplicate_groups(session: Session) -> None:  # noqa: D103
    d = make_device(session)
    same_hash = "a" * 64

    for i in range(3):
        e = FileEntry(
            device_id=d.id,
            path=f"/f{i}.txt",
            relative_path=f"f{i}.txt",
            size_bytes=10,
            sha256=same_hash,
            mtime=datetime.utcnow(),
            status=FileStatus.pending,
        )
        session.add(e)
    # Unique file — should NOT form a group
    unique = FileEntry(
        device_id=d.id,
        path="/unique.txt",
        relative_path="unique.txt",
        size_bytes=5,
        sha256="b" * 64,
        mtime=datetime.utcnow(),
        status=FileStatus.pending,
    )
    session.add(unique)
    session.commit()

    _build_duplicate_groups_from_hashes(d, session)

    groups = session.exec(select(DuplicateGroup)).all()
    assert len(groups) == 1
    assert groups[0].total_size_bytes == 30  # 3 × 10
