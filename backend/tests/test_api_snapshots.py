"""Tests for the snapshots list API."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_device, make_job, make_snapshot, make_storage_target


def test_list_snapshots_empty(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.get("/api/devices/1/snapshots")
    assert r.status_code == 200
    assert r.json() == []


def test_list_snapshots_device_not_found(client: TestClient) -> None:
    assert client.get("/api/devices/99/snapshots").status_code == 404


def test_list_snapshots_returns_records(client: TestClient, session: Session) -> None:
    device = make_device(session)
    job = make_job(session, device.id)
    target = make_storage_target(session)
    make_snapshot(session, device.id, job.id, target.id, restic_snapshot_id="abc12345")

    r = client.get(f"/api/devices/{device.id}/snapshots")
    assert r.status_code == 200
    snaps = r.json()
    assert len(snaps) == 1
    assert snaps[0]["restic_snapshot_id"] == "abc12345"
    assert snaps[0]["device_id"] == device.id
    assert snaps[0]["verified_at"] is None


def test_list_snapshots_ordered_newest_first(client: TestClient, session: Session) -> None:
    from datetime import datetime, timedelta

    device = make_device(session)
    job1 = make_job(session, device.id)
    job2 = make_job(session, device.id)
    target = make_storage_target(session)

    older = datetime.utcnow() - timedelta(hours=1)
    newer = datetime.utcnow()

    make_snapshot(
        session, device.id, job1.id, target.id, restic_snapshot_id="old00001", taken_at=older
    )
    make_snapshot(
        session, device.id, job2.id, target.id, restic_snapshot_id="new00001", taken_at=newer
    )

    r = client.get(f"/api/devices/{device.id}/snapshots")
    snaps = r.json()
    assert len(snaps) == 2
    assert snaps[0]["restic_snapshot_id"] == "new00001"
    assert snaps[1]["restic_snapshot_id"] == "old00001"
