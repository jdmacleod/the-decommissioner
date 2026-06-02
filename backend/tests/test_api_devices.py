"""Tests for device CRUD and job-trigger API."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_device


def test_list_devices_empty(client: TestClient) -> None:
    r = client.get("/api/devices")
    assert r.status_code == 200
    assert r.json() == []


def test_create_device(client: TestClient) -> None:
    r = client.post(
        "/api/devices",
        json={
            "name": "MBP 2019",
            "device_type": "mac",
            "source_path": "/Users/jason",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "MBP 2019"
    assert data["stage"] == "registered"
    assert data["id"] == 1


def test_create_device_minimal(client: TestClient) -> None:
    r = client.post("/api/devices", json={"name": "USB", "device_type": "usb_drive"})
    assert r.status_code == 201
    assert r.json()["source_path"] is None


def test_get_device(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.get("/api/devices/1")
    assert r.status_code == 200
    assert r.json()["id"] == 1


def test_get_device_not_found(client: TestClient) -> None:
    assert client.get("/api/devices/99").status_code == 404


def test_update_device(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.patch("/api/devices/1", json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"


def test_delete_device(client: TestClient, session: Session) -> None:
    make_device(session)
    assert client.delete("/api/devices/1").status_code == 204
    assert client.get("/api/devices/1").status_code == 404


def test_list_devices_returns_all(client: TestClient, session: Session) -> None:
    make_device(session, name="A")
    make_device(session, name="B")
    r = client.get("/api/devices")
    assert len(r.json()) == 2


def test_trigger_catalog_wrong_stage(client: TestClient, session: Session) -> None:
    make_device(session, stage="migrating")
    r = client.post("/api/devices/1/jobs", json={"job_type": "catalog"})
    assert r.status_code == 409


def test_trigger_catalog_registered(client: TestClient, session: Session) -> None:
    make_device(session, stage="registered", source_path="/tmp")
    r = client.post("/api/devices/1/jobs", json={"job_type": "catalog"})
    # 202 means task was spawned; actual job completion is async
    assert r.status_code == 202
    assert "job_id" in r.json()


def test_trigger_catalog_recatalog(client: TestClient, session: Session) -> None:
    make_device(session, stage="cataloged", source_path="/tmp")
    r = client.post("/api/devices/1/jobs", json={"job_type": "catalog"})
    assert r.status_code == 202


def test_trigger_unknown_job_type(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.post("/api/devices/1/jobs", json={"job_type": "teleport"})
    assert r.status_code == 422  # Pydantic validation


def test_trigger_job_device_not_found(client: TestClient) -> None:
    r = client.post("/api/devices/99/jobs", json={"job_type": "catalog"})
    assert r.status_code == 404


def test_update_device_not_found(client: TestClient) -> None:
    assert client.patch("/api/devices/99", json={"name": "X"}).status_code == 404


def test_delete_device_not_found(client: TestClient) -> None:
    assert client.delete("/api/devices/99").status_code == 404


def test_trigger_migrate_wrong_stage(client: TestClient, session: Session) -> None:
    """Non-catalog job type uses the elif FSM path."""
    make_device(session, stage="registered")
    r = client.post("/api/devices/1/jobs", json={"job_type": "migrate"})
    assert r.status_code == 409


def test_trigger_migrate_from_analyzed_stage(client: TestClient, session: Session) -> None:
    """Migrate from analyzed stage hits the next_stage assignment (line 107)."""
    from tests.conftest import make_storage_target

    make_device(session, stage="analyzed", source_path="/tmp")
    make_storage_target(session, is_default=True)
    r = client.post(
        "/api/devices/1/jobs",
        json={"job_type": "migrate", "storage_target_id": 1},
    )
    assert r.status_code == 202
    assert "job_id" in r.json()


def test_background_catalog_task_runs(
    engine: object,
    tmp_data_dir: object,
    monkeypatch: object,
) -> None:
    """Cover the _run() async task body for catalog jobs by capturing and awaiting it."""
    import asyncio
    import subprocess
    from contextlib import contextmanager
    from typing import Any
    from unittest.mock import MagicMock, patch

    from fastapi.testclient import TestClient
    from sqlmodel import Session as _Session

    import app.core.database as _db_module
    from app.core.deps import get_db_session
    from app.core.runner import SubprocessRunner
    from app.main import app

    @contextmanager  # type: ignore[misc]
    def _session_factory() -> Any:
        with _Session(engine) as s:  # type: ignore[arg-type]
            yield s

    def _override_session() -> Any:
        with _Session(engine) as s:  # type: ignore[arg-type]
            yield s

    monkeypatch.setattr(_db_module, "engine", engine)  # type: ignore[misc]
    monkeypatch.setattr(_db_module, "get_session", _session_factory)  # type: ignore[misc]
    app.dependency_overrides[get_db_session] = _override_session
    app.state.runner = SubprocessRunner(_session_factory)

    with _Session(engine) as s:  # type: ignore[arg-type]
        from tests.conftest import make_device as _make_device

        _make_device(s, source_path="/tmp/src")

    captured_coros: list[Any] = []

    def fake_create_task(coro: Any) -> Any:
        captured_coros.append(coro)
        return MagicMock()

    ok = MagicMock(spec=subprocess.CompletedProcess)
    ok.returncode = 0
    ok.stderr = ""

    async def _noop_catalog(job_id: int, device: Any, session: Any, runner: Any) -> None:
        pass

    try:
        with (
            patch("app.main.subprocess.run", return_value=ok),
            patch("app.core.deps.check_dependencies", MagicMock(return_value=[])),
            patch("app.api.devices.asyncio.create_task", fake_create_task),
            TestClient(app, raise_server_exceptions=True) as c,
        ):
            r = c.post("/api/devices/1/jobs", json={"job_type": "catalog"})
            assert r.status_code == 202

        assert len(captured_coros) == 1
        with patch("app.engines.catalog.run_catalog", _noop_catalog):
            asyncio.run(captured_coros[0])
    finally:
        app.dependency_overrides.pop(get_db_session, None)
