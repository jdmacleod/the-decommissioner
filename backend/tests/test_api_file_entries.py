"""Tests for file-entries API: pagination, filtering, bulk update."""

from datetime import datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_device


def _seed_entries(session: Session, device_id: int, count: int = 3) -> list:
    from app.models.enums import FileStatus
    from app.models.file_entry import FileEntry

    entries = []
    for i in range(count):
        e = FileEntry(
            device_id=device_id,
            path=f"/data/file{i}.txt",
            relative_path=f"file{i}.txt",
            size_bytes=100 * (i + 1),
            sha256=f"abc{i:061d}",
            mtime=datetime.utcnow(),
            status=FileStatus.pending,
        )
        session.add(e)
        entries.append(e)
    session.commit()
    for e in entries:
        session.refresh(e)
    return entries


def test_list_file_entries(client: TestClient, session: Session) -> None:
    d = make_device(session)
    _seed_entries(session, d.id, 3)
    r = client.get(f"/api/file-entries?device_id={d.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    # entries seeded with size_bytes 100, 200, 300 → total 600
    assert body["total_bytes"] == 600


def test_total_bytes_respects_filter(client: TestClient, session: Session) -> None:
    from app.models.enums import FileStatus

    d = make_device(session)
    entries = _seed_entries(session, d.id, 4)  # 100, 200, 300, 400 bytes
    for e in entries[:2]:
        e.status = FileStatus.keep
        session.add(e)
    session.commit()

    r = client.get(f"/api/file-entries?device_id={d.id}&status=keep")
    body = r.json()
    assert body["total"] == 2
    assert body["total_bytes"] == 300  # 100 + 200


def test_list_filter_by_status(client: TestClient, session: Session) -> None:
    from app.models.enums import FileStatus

    d = make_device(session)
    entries = _seed_entries(session, d.id, 4)
    # Mark two as keep
    for e in entries[:2]:
        e.status = FileStatus.keep
        session.add(e)
    session.commit()

    r = client.get(f"/api/file-entries?device_id={d.id}&status=keep")
    assert r.json()["total"] == 2


def test_list_filter_by_search(client: TestClient, session: Session) -> None:
    d = make_device(session)
    _seed_entries(session, d.id, 3)
    r = client.get(f"/api/file-entries?device_id={d.id}&search=file1")
    assert r.json()["total"] == 1


def test_list_pagination(client: TestClient, session: Session) -> None:
    d = make_device(session)
    _seed_entries(session, d.id, 5)
    r = client.get(f"/api/file-entries?device_id={d.id}&limit=2&page=0")
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2

    r2 = client.get(f"/api/file-entries?device_id={d.id}&limit=2&page=1")
    assert len(r2.json()["items"]) == 2

    r3 = client.get(f"/api/file-entries?device_id={d.id}&limit=2&page=2")
    assert len(r3.json()["items"]) == 1


def test_bulk_update_status(client: TestClient, session: Session) -> None:
    d = make_device(session)
    entries = _seed_entries(session, d.id, 3)
    updates = [{"id": entries[0].id, "status": "keep"}, {"id": entries[1].id, "status": "discard"}]
    r = client.patch("/api/file-entries", json=updates)
    assert r.status_code == 200
    assert r.json()["updated"] == 2

    # Verify in DB
    r2 = client.get(f"/api/file-entries?device_id={d.id}&status=keep")
    assert r2.json()["total"] == 1


def test_bulk_update_empty(client: TestClient) -> None:
    r = client.patch("/api/file-entries", json=[])
    assert r.status_code == 200
    assert r.json()["updated"] == 0


def test_bulk_update_missing_id(client: TestClient, session: Session) -> None:
    """Non-existent IDs are silently skipped."""
    make_device(session)
    r = client.patch("/api/file-entries", json=[{"id": 9999, "status": "keep"}])
    assert r.status_code == 200
    assert r.json()["updated"] == 0
