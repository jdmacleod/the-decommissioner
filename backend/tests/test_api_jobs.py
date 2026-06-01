"""Tests for job status and cancel API."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_device, make_job


def test_get_job(client: TestClient, session: Session) -> None:
    d = make_device(session)
    j = make_job(session, d.id)
    r = client.get(f"/api/jobs/{j.id}")
    assert r.status_code == 200
    assert r.json()["id"] == j.id
    assert r.json()["status"] == "pending"


def test_get_job_not_found(client: TestClient) -> None:
    assert client.get("/api/jobs/999").status_code == 404


def test_cancel_running_job(client: TestClient, session: Session) -> None:
    from app.models.enums import JobStatus

    d = make_device(session)
    j = make_job(session, d.id, status=JobStatus.in_progress)
    r = client.post(f"/api/jobs/{j.id}/cancel")
    assert r.status_code == 202
    assert r.json()["status"] == "cancellation_requested"


def test_cancel_completed_job(client: TestClient, session: Session) -> None:
    from app.models.enums import JobStatus

    d = make_device(session)
    j = make_job(session, d.id, status=JobStatus.completed)
    assert client.post(f"/api/jobs/{j.id}/cancel").status_code == 409


def test_cancel_not_found(client: TestClient) -> None:
    assert client.post("/api/jobs/999/cancel").status_code == 404


async def test_tail_log_reads_existing_lines(session: Session, tmp_path: Path) -> None:

    from app.api.jobs import _tail_log
    from app.models.enums import JobStatus

    log_file = tmp_path / "job.log"
    log_file.write_text("alpha\nbeta\n")

    d = make_device(session)
    j = make_job(session, d.id, status=JobStatus.completed)

    lines = []
    async for line in _tail_log(log_file, j.id, session):
        lines.append(line)

    assert "alpha\n" in lines
    assert "beta\n" in lines


async def test_tail_log_missing_file(session: Session, tmp_path: Path) -> None:

    from app.api.jobs import _tail_log

    d = make_device(session)
    j = make_job(session, d.id)

    lines = [line async for line in _tail_log(tmp_path / "absent.log", j.id, session)]
    assert lines == []


def test_stream_completed_job(client: TestClient, session: Session) -> None:
    from app.core.config import settings
    from app.models.enums import JobStatus

    d = make_device(session)
    j = make_job(session, d.id, status=JobStatus.completed)

    # Write the log where the runner expects it: settings.logs_dir/job_{id}.log
    log_file = settings.logs_dir / f"job_{j.id}.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.write_text("line one\nline two\n")

    # SSE replay for completed job
    with client.stream("GET", f"/api/jobs/{j.id}/stream") as r:
        assert r.status_code == 200
        content = r.read().decode()
    assert "line one" in content
    assert "event: done" in content
