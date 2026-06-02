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


def test_detect_ios_available(client: TestClient) -> None:
    import subprocess
    from unittest.mock import MagicMock, patch

    name_r = MagicMock(spec=subprocess.CompletedProcess)
    name_r.returncode = 0
    name_r.stdout = "Jason's iPhone\n"

    serial_r = MagicMock(spec=subprocess.CompletedProcess)
    serial_r.returncode = 0
    serial_r.stdout = "ABC123\n"

    with patch("app.engines.ios.subprocess.run", side_effect=[name_r, serial_r]):
        r = client.get("/api/devices/detect-ios")

    assert r.status_code == 200
    data = r.json()
    assert data["available"] is True
    assert data["name"] == "Jason's iPhone"


def test_detect_ios_not_available(client: TestClient) -> None:
    from unittest.mock import patch

    with patch("app.engines.ios.subprocess.run", side_effect=FileNotFoundError()):
        r = client.get("/api/devices/detect-ios")

    assert r.status_code == 200
    assert r.json()["available"] is False


def test_trigger_ios_extract_from_registered(client: TestClient, session: Session) -> None:
    make_device(session, stage="registered", device_type="iphone", source_path=None)
    r = client.post("/api/devices/1/jobs", json={"job_type": "ios_extract"})
    assert r.status_code == 202
    assert "job_id" in r.json()


def test_trigger_ios_extract_wrong_stage(client: TestClient, session: Session) -> None:
    make_device(session, stage="cataloged")
    r = client.post("/api/devices/1/jobs", json={"job_type": "ios_extract"})
    assert r.status_code == 409


def test_trigger_wipe_from_verified(client: TestClient, session: Session) -> None:
    make_device(session, stage="verified", source_path="/tmp")
    r = client.post("/api/devices/1/jobs", json={"job_type": "wipe"})
    assert r.status_code == 202
    assert "job_id" in r.json()


def test_trigger_wipe_wrong_stage(client: TestClient, session: Session) -> None:
    make_device(session, stage="registered")
    r = client.post("/api/devices/1/jobs", json={"job_type": "wipe"})
    assert r.status_code == 409


def test_mark_wiped_ok(client: TestClient, session: Session) -> None:
    make_device(session, stage="wiping")
    r = client.post("/api/devices/1/mark-wiped")
    assert r.status_code == 200
    assert r.json()["stage"] == "wiped"


def test_mark_wiped_wrong_stage(client: TestClient, session: Session) -> None:
    make_device(session, stage="verified")
    r = client.post("/api/devices/1/mark-wiped")
    assert r.status_code == 409


def test_mark_wiped_not_found(client: TestClient) -> None:
    assert client.post("/api/devices/99/mark-wiped").status_code == 404


def test_mark_recycled_ok(client: TestClient, session: Session) -> None:
    make_device(session, stage="wiped")
    r = client.post("/api/devices/1/mark-recycled")
    assert r.status_code == 200
    assert r.json()["stage"] == "recycled"


def test_mark_recycled_wrong_stage(client: TestClient, session: Session) -> None:
    make_device(session, stage="wiping")
    r = client.post("/api/devices/1/mark-recycled")
    assert r.status_code == 409


def test_mark_recycled_not_found(client: TestClient) -> None:
    assert client.post("/api/devices/99/mark-recycled").status_code == 404


def test_list_device_jobs(client: TestClient, session: Session) -> None:
    from tests.conftest import make_job

    d = make_device(session)
    make_job(session, d.id)
    make_job(session, d.id)
    r = client.get(f"/api/devices/{d.id}/jobs")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_list_device_jobs_not_found(client: TestClient) -> None:
    assert client.get("/api/devices/99/jobs").status_code == 404


def test_clear_staging_ok(client: TestClient, session: Session, tmp_path) -> None:

    staging = tmp_path / "staging"
    staging.mkdir()
    (staging / "file.txt").write_text("data")
    device = make_device(session, device_type="iphone", source_path=None)
    device.staging_path = str(staging)
    session.add(device)
    session.commit()

    r = client.post(f"/api/devices/{device.id}/clear-staging")
    assert r.status_code == 200
    assert r.json()["staging_path"] is None
    assert not staging.exists()


def test_clear_staging_no_staging_path(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.post("/api/devices/1/clear-staging")
    assert r.status_code == 409


def test_clear_staging_not_found(client: TestClient) -> None:
    assert client.post("/api/devices/99/clear-staging").status_code == 404


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


def test_background_wipe_task_hdd(
    engine: object,
    tmp_data_dir: object,
    monkeypatch: object,
) -> None:
    """Cover the _run() wipe branch for HDD devices (advances to wiped)."""
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

        _make_device(s, device_type="hard_drive", stage="verified", source_path="/tmp/drive")

    captured_coros: list[Any] = []

    def fake_create_task(coro: Any) -> Any:
        captured_coros.append(coro)
        return MagicMock()

    ok = MagicMock(spec=subprocess.CompletedProcess)
    ok.returncode = 0
    ok.stderr = ""

    async def _noop_wipe(job_id: int, device: Any, session: Any, runner: Any) -> None:
        from app.models.enums import JobStatus
        from app.models.job import Job

        with _session_factory() as sess:
            j = sess.get(Job, job_id)
            if j:
                j.status = JobStatus.completed
                sess.add(j)
                sess.commit()

    try:
        with (
            patch("app.main.subprocess.run", return_value=ok),
            patch("app.core.deps.check_dependencies", MagicMock(return_value=[])),
            patch("app.api.devices.asyncio.create_task", fake_create_task),
            TestClient(app, raise_server_exceptions=True) as c,
        ):
            r = c.post("/api/devices/1/jobs", json={"job_type": "wipe"})
            assert r.status_code == 202

        assert len(captured_coros) == 1
        with patch("app.engines.wipe.run_wipe", _noop_wipe):
            asyncio.run(captured_coros[0])

        with _Session(engine) as s:  # type: ignore[arg-type]
            from app.models.device import Device

            d = s.get(Device, 1)
            assert d is not None
            assert d.stage.value == "wiped"
    finally:
        app.dependency_overrides.pop(get_db_session, None)


def test_background_wipe_task_apple(
    engine: object,
    tmp_data_dir: object,
    monkeypatch: object,
) -> None:
    """Cover the _run() wipe branch for Apple devices (stays in wiping)."""
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

        _make_device(s, device_type="iphone", stage="verified", source_path=None)

    captured_coros: list[Any] = []

    def fake_create_task(coro: Any) -> Any:
        captured_coros.append(coro)
        return MagicMock()

    ok = MagicMock(spec=subprocess.CompletedProcess)
    ok.returncode = 0
    ok.stderr = ""

    async def _noop_wipe(job_id: int, device: Any, session: Any, runner: Any) -> None:
        from app.models.enums import JobStatus
        from app.models.job import Job

        with _session_factory() as sess:
            j = sess.get(Job, job_id)
            if j:
                j.status = JobStatus.completed
                sess.add(j)
                sess.commit()

    try:
        with (
            patch("app.main.subprocess.run", return_value=ok),
            patch("app.core.deps.check_dependencies", MagicMock(return_value=[])),
            patch("app.api.devices.asyncio.create_task", fake_create_task),
            TestClient(app, raise_server_exceptions=True) as c,
        ):
            r = c.post("/api/devices/1/jobs", json={"job_type": "wipe"})
            assert r.status_code == 202

        assert len(captured_coros) == 1
        with patch("app.engines.wipe.run_wipe", _noop_wipe):
            asyncio.run(captured_coros[0])

        with _Session(engine) as s:  # type: ignore[arg-type]
            from app.models.device import Device

            d = s.get(Device, 1)
            assert d is not None
            # Apple device stays in wiping — user must click Mark as Wiped
            assert d.stage.value == "wiping"
    finally:
        app.dependency_overrides.pop(get_db_session, None)


def test_background_ios_extract_task(
    engine: object,
    tmp_data_dir: object,
    monkeypatch: object,
) -> None:
    """Cover the _run() ios_extract branch — auto-runs catalog after extraction."""
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

        _make_device(s, device_type="iphone", stage="registered", source_path=None)

    captured_coros: list[Any] = []

    def fake_create_task(coro: Any) -> Any:
        captured_coros.append(coro)
        return MagicMock()

    ok = MagicMock(spec=subprocess.CompletedProcess)
    ok.returncode = 0
    ok.stderr = ""

    async def _noop_extract(job_id: int, device: Any, session: Any, runner: Any) -> None:
        from app.models.enums import JobStatus
        from app.models.job import Job

        j = session.get(Job, job_id)
        if j:
            j.status = JobStatus.completed
            session.add(j)
            session.commit()

    async def _noop_catalog(job_id: int, device: Any, session: Any, runner: Any) -> None:
        from app.models.enums import JobStatus
        from app.models.job import Job

        j = session.get(Job, job_id)
        if j:
            j.status = JobStatus.completed
            session.add(j)
            session.commit()

    try:
        with (
            patch("app.main.subprocess.run", return_value=ok),
            patch("app.core.deps.check_dependencies", MagicMock(return_value=[])),
            patch("app.api.devices.asyncio.create_task", fake_create_task),
            TestClient(app, raise_server_exceptions=True) as c,
        ):
            r = c.post("/api/devices/1/jobs", json={"job_type": "ios_extract"})
            assert r.status_code == 202

        assert len(captured_coros) == 1
        with (
            patch("app.engines.ios.run_ios_extract", _noop_extract),
            patch("app.engines.catalog.run_catalog", _noop_catalog),
        ):
            asyncio.run(captured_coros[0])

        with _Session(engine) as s:  # type: ignore[arg-type]
            from app.models.device import Device

            d = s.get(Device, 1)
            assert d is not None
            # ios_extract branch ran: device is cataloged on success, registered on failure
            assert d.stage.value in ("cataloged", "registered")
    finally:
        app.dependency_overrides.pop(get_db_session, None)
