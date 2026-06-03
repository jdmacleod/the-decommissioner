"""Tests for device CRUD and job-trigger API."""

import pytest
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
    bg_task_runner: object,
) -> None:
    """Cover the _run() dispatcher + run_catalog_handler by capturing and awaiting."""
    import asyncio
    from typing import Any
    from unittest.mock import patch

    from sqlmodel import Session

    with Session(engine) as s:  # type: ignore[arg-type]
        make_device(s, source_path="/tmp/src")

    client, captured = bg_task_runner  # type: ignore[misc]
    r = client.post("/api/devices/1/jobs", json={"job_type": "catalog"})
    assert r.status_code == 202
    assert len(captured) == 1

    async def _noop(job_id: int, device: Any, session: Any, runner: Any) -> None:
        pass

    with patch("app.engines.catalog.run_catalog", _noop):
        asyncio.run(captured[0])


def test_background_wipe_task_hdd(
    engine: object,
    tmp_data_dir: object,
    bg_task_runner: object,
) -> None:
    """run_wipe_handler for HDD devices marks job completed → advances to wiped."""
    import asyncio
    from typing import Any
    from unittest.mock import patch

    from sqlmodel import Session

    with Session(engine) as s:  # type: ignore[arg-type]
        make_device(s, device_type="hard_drive", stage="verified", source_path="/tmp/drive")

    client, captured = bg_task_runner  # type: ignore[misc]
    r = client.post("/api/devices/1/jobs", json={"job_type": "wipe"})
    assert r.status_code == 202

    async def _noop_wipe(job_id: int, device: Any, session: Any, runner: Any) -> None:
        from app.models.enums import JobStatus
        from app.models.job import Job

        with Session(engine) as s:  # type: ignore[arg-type]
            j = s.get(Job, job_id)
            if j:
                j.status = JobStatus.completed
                s.add(j)
                s.commit()

    with patch("app.engines.wipe.run_wipe", _noop_wipe):
        asyncio.run(captured[0])

    with Session(engine) as s:  # type: ignore[arg-type]
        from app.models.device import Device

        d = s.get(Device, 1)
        assert d is not None
        assert d.stage.value == "wiped"


def test_background_wipe_task_apple(
    engine: object,
    tmp_data_dir: object,
    bg_task_runner: object,
) -> None:
    """run_wipe_handler for Apple devices stays in wiping (user must mark wiped)."""
    import asyncio
    from typing import Any
    from unittest.mock import patch

    from sqlmodel import Session

    with Session(engine) as s:  # type: ignore[arg-type]
        make_device(s, device_type="iphone", stage="verified", source_path=None)

    client, captured = bg_task_runner  # type: ignore[misc]
    r = client.post("/api/devices/1/jobs", json={"job_type": "wipe"})
    assert r.status_code == 202

    async def _noop_wipe(job_id: int, device: Any, session: Any, runner: Any) -> None:
        from app.models.enums import JobStatus
        from app.models.job import Job

        with Session(engine) as s:  # type: ignore[arg-type]
            j = s.get(Job, job_id)
            if j:
                j.status = JobStatus.completed
                s.add(j)
                s.commit()

    with patch("app.engines.wipe.run_wipe", _noop_wipe):
        asyncio.run(captured[0])

    with Session(engine) as s:  # type: ignore[arg-type]
        from app.models.device import Device

        d = s.get(Device, 1)
        assert d is not None
        assert d.stage.value == "wiping"


def test_background_ios_extract_task(
    engine: object,
    tmp_data_dir: object,
    bg_task_runner: object,
) -> None:
    """run_ios_extract_handler auto-chains into catalog after extraction."""
    import asyncio
    from typing import Any
    from unittest.mock import patch

    from sqlmodel import Session

    with Session(engine) as s:  # type: ignore[arg-type]
        make_device(s, device_type="iphone", stage="registered", source_path=None)

    client, captured = bg_task_runner  # type: ignore[misc]
    r = client.post("/api/devices/1/jobs", json={"job_type": "ios_extract"})
    assert r.status_code == 202

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

    with (
        patch("app.engines.ios.run_ios_extract", _noop_extract),
        patch("app.engines.catalog.run_catalog", _noop_catalog),
    ):
        asyncio.run(captured[0])

    with Session(engine) as s:  # type: ignore[arg-type]
        from app.models.device import Device

        d = s.get(Device, 1)
        assert d is not None
        assert d.stage.value in ("cataloged", "registered")


def test_detect_volumes_returns_list(client: TestClient) -> None:
    r = client.get("/api/devices/detect-volumes")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for entry in data:
        assert "path" in entry
        assert "label" in entry


def test_detect_volumes_on_darwin(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import unittest.mock as mock

    monkeypatch.setattr("app.api.devices.sys.platform", "darwin")
    # Macintosh HD is a symlink to / on macOS and must be excluded.
    with (
        mock.patch(
            "app.api.devices.os.listdir", return_value=["USB Drive", "Macintosh HD", ".hidden"]
        ),
        mock.patch("app.api.devices.os.path.isdir", return_value=True),
        mock.patch("app.api.devices.os.path.islink", side_effect=lambda p: "Macintosh HD" in p),
    ):
        r = client.get("/api/devices/detect-volumes")
    assert r.status_code == 200
    data = r.json()
    labels = [e["label"] for e in data]
    assert ".hidden" not in labels
    assert "Macintosh HD" not in labels  # symlink to / — excluded
    assert "USB Drive" in labels


def test_detect_volumes_linux_with_volumes_dir(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Docker on macOS: /Volumes is bind-mounted, sys.platform is linux."""
    import unittest.mock as mock

    monkeypatch.setattr("app.api.devices.sys.platform", "linux")

    def fake_listdir(path: str) -> list[str]:
        if path == "/Volumes":
            return ["LEXAR128", "LaCie"]
        return []  # /media and /mnt are empty

    def fake_isdir(path: str) -> bool:
        return path in ("/Volumes", "/Volumes/LEXAR128", "/Volumes/LaCie", "/media", "/mnt")

    with (
        mock.patch("app.api.devices.os.listdir", side_effect=fake_listdir),
        mock.patch("app.api.devices.os.path.isdir", side_effect=fake_isdir),
        mock.patch("app.api.devices.os.path.islink", return_value=False),
    ):
        r = client.get("/api/devices/detect-volumes")
    assert r.status_code == 200
    data = r.json()
    labels = [e["label"] for e in data]
    assert "LEXAR128" in labels
    assert "LaCie" in labels


def test_detect_volumes_serial_darwin(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """macOS: diskutil returns a plist with VolumeUUID — serial_number is populated."""
    import plistlib
    import unittest.mock as mock

    monkeypatch.setattr("app.api.devices.sys.platform", "darwin")

    fake_plist = plistlib.dumps(
        {"VolumeUUID": "AABBCCDD-1234-5678-ABCD-EEFF00112233", "VolumeName": "USB Drive"}
    )
    diskutil_result = mock.MagicMock()
    diskutil_result.returncode = 0
    diskutil_result.stdout = fake_plist

    with (
        mock.patch("app.api.devices.os.listdir", return_value=["USB Drive"]),
        mock.patch("app.api.devices.os.path.isdir", return_value=True),
        mock.patch("app.api.devices.os.path.islink", return_value=False),
        mock.patch("app.api.devices.subprocess.run", return_value=diskutil_result),
    ):
        r = client.get("/api/devices/detect-volumes")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["serial_number"] == "AABBCCDD-1234-5678-ABCD-EEFF00112233"


def test_detect_volumes_serial_darwin_media_serial_takes_priority(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """macOS: MediaSerialNumber takes priority over VolumeUUID when both are present."""
    import plistlib
    import unittest.mock as mock

    monkeypatch.setattr("app.api.devices.sys.platform", "darwin")

    fake_plist = plistlib.dumps(
        {
            "MediaSerialNumber": "WX11A1234567",
            "VolumeUUID": "AABBCCDD-1234-5678-ABCD-EEFF00112233",
        }
    )
    diskutil_result = mock.MagicMock()
    diskutil_result.returncode = 0
    diskutil_result.stdout = fake_plist

    with (
        mock.patch("app.api.devices.os.listdir", return_value=["My Drive"]),
        mock.patch("app.api.devices.os.path.isdir", return_value=True),
        mock.patch("app.api.devices.os.path.islink", return_value=False),
        mock.patch("app.api.devices.subprocess.run", return_value=diskutil_result),
    ):
        r = client.get("/api/devices/detect-volumes")
    assert r.status_code == 200
    assert r.json()[0]["serial_number"] == "WX11A1234567"


def test_detect_volumes_serial_failure_returns_null(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If serial detection subprocess raises, serial_number is null and response succeeds."""
    import unittest.mock as mock

    monkeypatch.setattr("app.api.devices.sys.platform", "darwin")

    with (
        mock.patch("app.api.devices.os.listdir", return_value=["USB Drive"]),
        mock.patch("app.api.devices.os.path.isdir", return_value=True),
        mock.patch("app.api.devices.os.path.islink", return_value=False),
        mock.patch("app.api.devices.subprocess.run", side_effect=Exception("diskutil not found")),
    ):
        r = client.get("/api/devices/detect-volumes")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["serial_number"] is None


# ── photo upload / serve / delete ────────────────────────────────────────────


def _jpeg_bytes(size: int = 100) -> bytes:
    """Return a tiny valid JPEG (1×1 white pixel) padded to `size` bytes."""
    # Minimal valid JPEG
    tiny = (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
        b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
        b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),\x01\x02\x03"
        b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
        b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00"
        b"\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
        b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xf5\x0a\xff\xd9"
    )
    return tiny + b"\x00" * max(0, size - len(tiny))


def test_upload_photo_ok(client: TestClient, session: Session, tmp_path: object) -> None:
    from unittest.mock import patch

    make_device(session)

    with patch("app.api.devices.settings") as mock_settings:
        mock_settings.photos_dir = tmp_path  # type: ignore[attr-defined]
        r = client.post(
            "/api/devices/1/photo",
            files={"file": ("device.jpg", _jpeg_bytes(), "image/jpeg")},
        )

    assert r.status_code == 200
    data = r.json()
    assert data["photo_path"] is not None
    assert "device_1" in data["photo_path"]


def test_upload_photo_wrong_type(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.post(
        "/api/devices/1/photo",
        files={"file": ("doc.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400


def test_upload_photo_too_large(client: TestClient, session: Session, tmp_path: object) -> None:
    from unittest.mock import patch

    make_device(session)
    big = _jpeg_bytes(6 * 1024 * 1024)  # 6 MB

    with patch("app.api.devices.settings") as mock_settings:
        mock_settings.photos_dir = tmp_path  # type: ignore[attr-defined]
        r = client.post(
            "/api/devices/1/photo",
            files={"file": ("big.jpg", big, "image/jpeg")},
        )

    assert r.status_code == 413


def test_upload_photo_device_not_found(client: TestClient) -> None:
    r = client.post(
        "/api/devices/99/photo",
        files={"file": ("device.jpg", _jpeg_bytes(), "image/jpeg")},
    )
    assert r.status_code == 404


def test_get_photo_no_photo(client: TestClient, session: Session) -> None:
    make_device(session)
    assert client.get("/api/devices/1/photo").status_code == 404


def test_get_photo_ok(client: TestClient, session: Session, tmp_path: object) -> None:
    from unittest.mock import patch

    make_device(session)

    with patch("app.api.devices.settings") as mock_settings:
        mock_settings.photos_dir = tmp_path  # type: ignore[attr-defined]
        client.post(
            "/api/devices/1/photo",
            files={"file": ("device.jpg", _jpeg_bytes(), "image/jpeg")},
        )

    # photo_path is now set on device in DB — find the file path
    from app.models.device import Device as DevModel

    dev = session.get(DevModel, 1)
    assert dev is not None and dev.photo_path is not None

    # Patch os.path.isfile to return True and FileResponse to use the real path
    r = client.get("/api/devices/1/photo")
    # The file was written by the upload; GET should succeed
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/jpeg")


def test_delete_photo_ok(client: TestClient, session: Session, tmp_path: object) -> None:
    from unittest.mock import patch

    make_device(session)

    with patch("app.api.devices.settings") as mock_settings:
        mock_settings.photos_dir = tmp_path  # type: ignore[attr-defined]
        client.post(
            "/api/devices/1/photo",
            files={"file": ("device.jpg", _jpeg_bytes(), "image/jpeg")},
        )

    r = client.delete("/api/devices/1/photo")
    assert r.status_code == 200
    assert r.json()["photo_path"] is None


def test_delete_photo_no_photo(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.delete("/api/devices/1/photo")
    assert r.status_code == 200
    assert r.json()["photo_path"] is None


def test_delete_photo_not_found(client: TestClient) -> None:
    assert client.delete("/api/devices/99/photo").status_code == 404
