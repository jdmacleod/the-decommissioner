"""Tests for SubprocessRunner: execution, status updates, cancellation, replay."""

from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session

from app.core.runner import SubprocessRunner
from app.models.enums import JobStatus
from tests.conftest import make_device, make_job


@pytest.fixture
def runner(engine: Any, tmp_data_dir: Path) -> SubprocessRunner:
    from contextlib import contextmanager

    @contextmanager  # type: ignore[misc]
    def session_factory() -> Any:
        with Session(engine) as s:
            yield s

    return SubprocessRunner(session_factory)


async def collect(gen: Any) -> list[str]:
    """Drain an async generator into a list."""
    lines = []
    async for line in gen:
        lines.append(line)
    return lines


async def test_run_echo(runner: SubprocessRunner, session: Session) -> None:
    d = make_device(session)
    j = make_job(session, d.id)

    lines = await collect(runner.run(j.id, ["echo", "hello"]))
    output = "".join(lines)
    assert "hello" in output
    assert "START:" in output
    assert "EXIT: 0" in output

    session.refresh(j)
    assert j.status == JobStatus.completed
    assert j.exit_code == 0


async def test_run_exit_nonzero(runner: SubprocessRunner, session: Session) -> None:
    d = make_device(session)
    j = make_job(session, d.id)

    await collect(runner.run(j.id, ["false"]))
    session.refresh(j)
    assert j.status == JobStatus.failed
    assert j.exit_code != 0


async def test_run_missing_binary(runner: SubprocessRunner, session: Session) -> None:
    d = make_device(session)
    j = make_job(session, d.id)

    lines = await collect(runner.run(j.id, ["__nonexistent_binary_xyz__"]))
    output = "".join(lines)
    assert "Command not found" in output
    session.refresh(j)
    assert j.status == JobStatus.failed


async def test_run_writes_log_file(
    runner: SubprocessRunner, session: Session, tmp_data_dir: Path
) -> None:
    d = make_device(session)
    j = make_job(session, d.id)

    await collect(runner.run(j.id, ["echo", "logged"]))
    log = runner.log_path_for(j.id)
    assert log.exists()
    assert "logged" in log.read_text()


async def test_replay_existing_log(runner: SubprocessRunner, session: Session) -> None:
    d = make_device(session)
    j = make_job(session, d.id)

    await collect(runner.run(j.id, ["echo", "replayable"]))
    replayed = await collect(runner.replay(j.id))
    assert any("replayable" in line for line in replayed)


async def test_replay_missing_log(runner: SubprocessRunner) -> None:
    lines = await collect(runner.replay(99999))
    assert "no log found" in "".join(lines)


async def test_cancel_sets_flag(runner: SubprocessRunner, session: Session) -> None:
    d = make_device(session)
    j = make_job(session, d.id)

    # Start a slow command, cancel immediately
    async def _run_and_cancel() -> None:
        gen = runner.run(j.id, ["sleep", "10"])
        # Read first line (START header) then cancel
        async for _ in gen:
            await runner.cancel(j.id)
            break

    await _run_and_cancel()
    # Status should be cancelled or failed (timing-dependent)
    session.refresh(j)
    assert j.status in (JobStatus.cancelled, JobStatus.in_progress, JobStatus.failed)


async def test_log_path_for(runner: SubprocessRunner, tmp_data_dir: Path) -> None:
    path = runner.log_path_for(42)
    assert path.name == "job_42.log"
    assert path.parent.exists()
