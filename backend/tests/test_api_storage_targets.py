"""Tests for the storage targets CRUD + test/init API."""

import subprocess
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_storage_target


def test_list_targets_empty(client: TestClient) -> None:
    r = client.get("/api/storage-targets")
    assert r.status_code == 200
    assert r.json() == []


def test_create_target(client: TestClient) -> None:
    r = client.post(
        "/api/storage-targets",
        json={
            "name": "My Repo",
            "backend": "local",
            "path": "/Volumes/Backup/repo",
            "restic_password_env": "RESTIC_PASSWORD",
            "is_default": False,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "My Repo"
    assert data["backend"] == "local"
    assert data["initialized"] is False
    assert data["id"] == 1


def test_create_target_sets_default(client: TestClient, session: Session) -> None:
    make_storage_target(session, name="Old Default", is_default=True)
    r = client.post(
        "/api/storage-targets",
        json={"name": "New Default", "backend": "local", "path": "/new", "is_default": True},
    )
    assert r.status_code == 201

    # Old default should be cleared
    r2 = client.get("/api/storage-targets")
    targets = r2.json()
    defaults = [t for t in targets if t["is_default"]]
    assert len(defaults) == 1
    assert defaults[0]["name"] == "New Default"


def test_update_target(client: TestClient, session: Session) -> None:
    make_storage_target(session)
    r = client.patch("/api/storage-targets/1", json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"


def test_update_target_set_default_clears_others(client: TestClient, session: Session) -> None:
    t1 = make_storage_target(session, name="First", is_default=True)
    make_storage_target(session, name="Second", is_default=False)

    r = client.patch(f"/api/storage-targets/{t1.id + 1}", json={"is_default": True})
    assert r.status_code == 200

    r2 = client.get("/api/storage-targets")
    defaults = [t for t in r2.json() if t["is_default"]]
    assert len(defaults) == 1


def test_update_target_not_found(client: TestClient) -> None:
    assert client.patch("/api/storage-targets/99", json={"name": "X"}).status_code == 404


def test_delete_target(client: TestClient, session: Session) -> None:
    make_storage_target(session)
    assert client.delete("/api/storage-targets/1").status_code == 204
    assert client.get("/api/storage-targets").json() == []


def test_delete_target_not_found(client: TestClient) -> None:
    assert client.delete("/api/storage-targets/99").status_code == 404


def test_test_target_success(client: TestClient, session: Session) -> None:
    make_storage_target(session)
    ok_result = MagicMock(spec=subprocess.CompletedProcess)
    ok_result.returncode = 0
    ok_result.stdout = "[]"
    ok_result.stderr = ""
    with patch("app.api.storage_targets.subprocess.run", return_value=ok_result):
        r = client.post("/api/storage-targets/1/test")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_test_target_failure(client: TestClient, session: Session) -> None:
    make_storage_target(session)
    fail_result = MagicMock(spec=subprocess.CompletedProcess)
    fail_result.returncode = 1
    fail_result.stdout = ""
    fail_result.stderr = "Fatal: unable to open repo"
    with patch("app.api.storage_targets.subprocess.run", return_value=fail_result):
        r = client.post("/api/storage-targets/1/test")
    assert r.status_code == 200
    assert r.json()["ok"] is False


def test_test_target_not_found(client: TestClient) -> None:
    assert client.post("/api/storage-targets/99/test").status_code == 404


def test_init_target_success(client: TestClient, session: Session) -> None:
    make_storage_target(session)
    ok_result = MagicMock(spec=subprocess.CompletedProcess)
    ok_result.returncode = 0
    ok_result.stdout = "created restic repository"
    ok_result.stderr = ""
    with patch("app.api.storage_targets.subprocess.run", return_value=ok_result):
        r = client.post("/api/storage-targets/1/init")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    # Verify initialized flag was set
    target = client.get("/api/storage-targets").json()[0]
    assert target["initialized"] is True


def test_init_target_failure(client: TestClient, session: Session) -> None:
    make_storage_target(session)
    fail_result = MagicMock(spec=subprocess.CompletedProcess)
    fail_result.returncode = 1
    fail_result.stdout = ""
    fail_result.stderr = "already initialized"
    with patch("app.api.storage_targets.subprocess.run", return_value=fail_result):
        r = client.post("/api/storage-targets/1/init")
    assert r.status_code == 200
    assert r.json()["ok"] is False
    target = client.get("/api/storage-targets").json()[0]
    assert target["initialized"] is False


def test_init_target_not_found(client: TestClient) -> None:
    assert client.post("/api/storage-targets/99/init").status_code == 404


def test_list_targets_multiple(client: TestClient, session: Session) -> None:
    make_storage_target(session, name="A")
    make_storage_target(session, name="B")
    r = client.get("/api/storage-targets")
    assert len(r.json()) == 2
