"""Tests for create_job helper."""

from pathlib import Path

from sqlmodel import Session

from app.core.job_factory import create_job
from app.models.enums import JobStatus, JobType
from tests.conftest import make_device


def test_create_job_returns_pending(session: Session, tmp_data_dir: Path) -> None:
    d = make_device(session)
    job = create_job(session, d.id, JobType.catalog)
    assert job.status == JobStatus.pending
    assert job.job_type == JobType.catalog
    assert job.device_id == d.id


def test_create_job_sets_log_path(session: Session, tmp_data_dir: Path) -> None:
    d = make_device(session)
    job = create_job(session, d.id, JobType.catalog)
    assert job.log_path
    assert f"job_{job.id}.log" in job.log_path


def test_create_job_log_dir_created(session: Session, tmp_data_dir: Path) -> None:
    d = make_device(session)
    create_job(session, d.id, JobType.catalog)
    assert (tmp_data_dir / "logs").exists()
