"""Shared pytest fixtures for the-decommissioner backend tests."""

import subprocess
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

# ── Database fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(name="tmp_data_dir")
def tmp_data_dir_fixture(tmp_path: Path) -> Path:
    """A temporary DATA_DIR with logs/ pre-created."""
    (tmp_path / "logs").mkdir()
    return tmp_path


@pytest.fixture(name="engine")
def engine_fixture(tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    """In-memory SQLite engine. Patches settings.data_dir so logs go to tmp_path."""
    monkeypatch.setenv("DATA_DIR", str(tmp_data_dir))

    import app.core.config as cfg

    new_settings = cfg.Settings()
    monkeypatch.setattr(cfg, "settings", new_settings)

    import app.core.runner as runner_module

    monkeypatch.setattr(runner_module, "settings", new_settings)

    import app.models  # noqa: F401 — registers all SQLModel tables with metadata

    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    return test_engine


@pytest.fixture(name="session")
def session_fixture(engine: Any) -> Generator[Session, None, None]:
    with Session(engine) as s:
        yield s


# ── TestClient fixture ────────────────────────────────────────────────────────


@pytest.fixture(name="client")
def client_fixture(
    engine: Any,
    tmp_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    """
    FastAPI TestClient wired to the test database.
    Uses dependency_overrides for the session so API routes get the test DB.
    Patches subprocess.run (alembic) and check_dependencies so the
    lifespan completes instantly with no external calls.
    """
    import app.core.database as db_module
    from app.core.deps import get_db_session
    from app.core.runner import SubprocessRunner
    from app.main import app

    @contextmanager  # type: ignore[misc]
    def test_session_factory() -> Generator[Session, None, None]:
        with Session(engine) as s:
            yield s

    def override_get_db_session() -> Generator[Session, None, None]:
        with Session(engine) as s:
            yield s

    # Patch the module-level engine and get_session for background tasks
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "get_session", test_session_factory)

    # Override the FastAPI dependency so API route handlers use the test DB
    app.dependency_overrides[get_db_session] = override_get_db_session

    # Patch the runner singleton lookup used by get_runner() in API routes
    app.state.runner = SubprocessRunner(test_session_factory)

    # Make alembic upgrade head return instantly with success
    ok_result = MagicMock(spec=subprocess.CompletedProcess)
    ok_result.returncode = 0
    ok_result.stderr = ""

    # Make check_dependencies a no-op (avoids running shutil.which / subprocess per tool)
    noop_deps = MagicMock(return_value=[])

    # Prevent background job tasks from running during API tests.
    # create_task is called by the job-trigger endpoint; we close the coroutine
    # so the event loop has no pending work when the TestClient exits.
    def _noop_create_task(coro: Any) -> Any:
        coro.close()
        return MagicMock()

    try:
        with (
            patch("app.main.subprocess.run", return_value=ok_result),
            patch("app.core.deps.check_dependencies", noop_deps),
            patch("app.api.devices.asyncio.create_task", side_effect=_noop_create_task),
            TestClient(app, raise_server_exceptions=True) as c,
        ):
            yield c
    finally:
        app.dependency_overrides.pop(get_db_session, None)


# ── Sample data helpers ───────────────────────────────────────────────────────


def make_device(session: Session, **kwargs: Any) -> Any:
    from app.models.device import Device
    from app.models.enums import DeviceStage, DeviceType

    device = Device(
        name=kwargs.get("name", "Test Device"),
        device_type=kwargs.get("device_type", DeviceType.hard_drive),
        source_path=kwargs.get("source_path", "/tmp/test"),
        stage=kwargs.get("stage", DeviceStage.registered),
    )
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


def make_job(session: Session, device_id: int, **kwargs: Any) -> Any:
    from datetime import datetime

    from app.models.enums import JobStatus, JobType
    from app.models.job import Job

    job = Job(
        device_id=device_id,
        job_type=kwargs.get("job_type", JobType.catalog),
        status=kwargs.get("status", JobStatus.pending),
        log_path=kwargs.get("log_path", "/tmp/test.log"),
        created_at=datetime.utcnow(),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def make_storage_target(session: Session, **kwargs: Any) -> Any:
    from app.models.enums import StorageBackend
    from app.models.storage_target import StorageTarget

    target = StorageTarget(
        name=kwargs.get("name", "Test Repo"),
        backend=kwargs.get("backend", StorageBackend.local),
        path=kwargs.get("path", "/tmp/restic-repo"),
        restic_password_env=kwargs.get("restic_password_env", "RESTIC_PASSWORD"),
        is_default=kwargs.get("is_default", False),
        initialized=kwargs.get("initialized", False),
    )
    session.add(target)
    session.commit()
    session.refresh(target)
    return target


def make_snapshot(
    session: Session, device_id: int, job_id: int, target_id: int, **kwargs: Any
) -> Any:
    from datetime import datetime

    from app.models.snapshot import Snapshot

    snap = Snapshot(
        device_id=device_id,
        job_id=job_id,
        storage_target_id=target_id,
        restic_snapshot_id=kwargs.get("restic_snapshot_id", "abc12345"),
        file_count=kwargs.get("file_count", 100),
        total_bytes=kwargs.get("total_bytes", 1024 * 1024),
        added_bytes=kwargs.get("added_bytes", 512 * 1024),
        tags='["device-1", "hard_drive", "the-decommissioner"]',
        taken_at=kwargs.get("taken_at", datetime.utcnow()),
    )
    session.add(snap)
    session.commit()
    session.refresh(snap)
    return snap
