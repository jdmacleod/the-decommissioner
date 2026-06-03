"""Tests for the snapshots list API."""

import json

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


# --- verify-diff endpoint ---


def test_verify_diff_device_not_found(client: TestClient) -> None:
    assert client.get("/api/devices/99/verify-diff").status_code == 404


def test_verify_diff_no_verify_job_returns_empty(client: TestClient, session: Session) -> None:
    make_device(session)
    r = client.get("/api/devices/1/verify-diff")
    assert r.status_code == 200
    data = r.json()
    assert data["discrepancy"] is False
    assert data["catalog_count"] == 0
    assert data["snapshot_count"] == 0
    assert data["missing_paths"] == []


def test_verify_diff_job_without_metadata_returns_empty(
    client: TestClient, session: Session
) -> None:
    from app.models.enums import JobStatus, JobType

    device = make_device(session)
    make_job(session, device.id, job_type=JobType.verify, status=JobStatus.completed)
    r = client.get(f"/api/devices/{device.id}/verify-diff")
    assert r.status_code == 200
    data = r.json()
    assert data["discrepancy"] is False
    assert data["missing_paths"] == []


def test_verify_diff_no_discrepancy(client: TestClient, session: Session) -> None:
    from app.models.enums import JobStatus, JobType

    device = make_device(session)
    job = make_job(
        session,
        device.id,
        job_type=JobType.verify,
        status=JobStatus.completed,
    )
    # inject metadata directly
    from app.models.job import Job

    j = session.get(Job, job.id)
    assert j is not None
    j.job_metadata = json.dumps(
        {"discrepancy": False, "catalog_count": 100, "snapshot_count": 100, "missing_paths": []}
    )
    session.add(j)
    session.commit()

    r = client.get(f"/api/devices/{device.id}/verify-diff")
    assert r.status_code == 200
    data = r.json()
    assert data["discrepancy"] is False
    assert data["catalog_count"] == 100
    assert data["snapshot_count"] == 100
    assert data["missing_paths"] == []


def test_verify_diff_with_discrepancy(client: TestClient, session: Session) -> None:
    from app.models.enums import JobStatus, JobType

    device = make_device(session)
    job = make_job(
        session,
        device.id,
        job_type=JobType.verify,
        status=JobStatus.completed,
    )
    from app.models.job import Job

    j = session.get(Job, job.id)
    assert j is not None
    j.job_metadata = json.dumps(
        {
            "discrepancy": True,
            "catalog_count": 50,
            "snapshot_count": 48,
            "missing_paths": ["/src/file_a.txt", "/src/file_b.txt"],
        }
    )
    session.add(j)
    session.commit()

    r = client.get(f"/api/devices/{device.id}/verify-diff")
    assert r.status_code == 200
    data = r.json()
    assert data["discrepancy"] is True
    assert data["catalog_count"] == 50
    assert data["snapshot_count"] == 48
    assert len(data["missing_paths"]) == 2
    assert "/src/file_a.txt" in data["missing_paths"]


def test_verify_diff_returns_latest_completed_job(client: TestClient, session: Session) -> None:
    """When multiple verify jobs exist, only the most recent completed one is used."""
    from app.models.enums import JobStatus, JobType
    from app.models.job import Job

    device = make_device(session)
    old_job = make_job(session, device.id, job_type=JobType.verify, status=JobStatus.completed)
    new_job = make_job(session, device.id, job_type=JobType.verify, status=JobStatus.completed)

    for jid, payload in [
        (
            old_job.id,
            {
                "discrepancy": True,
                "catalog_count": 10,
                "snapshot_count": 9,
                "missing_paths": ["/old"],
            },
        ),
        (
            new_job.id,
            {"discrepancy": False, "catalog_count": 10, "snapshot_count": 10, "missing_paths": []},
        ),
    ]:
        j = session.get(Job, jid)
        assert j is not None
        j.job_metadata = json.dumps(payload)
        session.add(j)
    session.commit()

    r = client.get(f"/api/devices/{device.id}/verify-diff")
    assert r.status_code == 200
    data = r.json()
    # new_job (no discrepancy) should win
    assert data["discrepancy"] is False
    assert data["missing_paths"] == []
