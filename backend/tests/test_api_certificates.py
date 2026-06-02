"""Tests for the certificate generation endpoint."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_device, make_job, make_snapshot, make_storage_target


def test_certificate_returns_pdf(client: TestClient, session: Session) -> None:
    make_device(session, name="Test MBP", stage="wiped")
    r = client.get("/api/devices/1/certificate")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert b"%PDF" in r.content


def test_certificate_device_not_found(client: TestClient) -> None:
    r = client.get("/api/devices/99/certificate")
    assert r.status_code == 404


def test_certificate_with_snapshot(client: TestClient, session: Session) -> None:
    device = make_device(session, stage="verified")
    job = make_job(session, device.id)
    target = make_storage_target(session)
    make_snapshot(session, device.id, job.id, target.id, restic_snapshot_id="aabbccdd")
    r = client.get(f"/api/devices/{device.id}/certificate")
    assert r.status_code == 200
    assert b"%PDF" in r.content


def test_certificate_includes_jobs(client: TestClient, session: Session) -> None:
    device = make_device(session)
    from app.models.enums import JobStatus, JobType

    make_job(session, device.id, job_type=JobType.catalog, status=JobStatus.completed)
    r = client.get(f"/api/devices/{device.id}/certificate")
    assert r.status_code == 200


def test_certificate_content_disposition(client: TestClient, session: Session) -> None:
    device = make_device(session)
    r = client.get(f"/api/devices/{device.id}/certificate")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert f"decommission-{device.id}.pdf" in cd
