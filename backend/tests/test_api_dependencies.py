"""Tests for dependencies list and recheck API endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session


def test_list_dependencies_api(client: TestClient, session: Session) -> None:
    """GET /api/dependencies returns the dependency list."""
    from app.models.dependency import Dependency
    from app.models.enums import DependencyStatus

    dep = Dependency(
        name="restic",
        required_for='["migrate"]',
        status=DependencyStatus.found,
        version="0.16.0",
        install_hint="brew install restic",
    )
    session.add(dep)
    session.commit()

    r = client.get("/api/dependencies")
    assert r.status_code == 200
    assert any(d["name"] == "restic" for d in r.json())


def test_recheck_dependencies_api(client: TestClient) -> None:
    """POST /api/dependencies/recheck triggers a fresh check."""
    with patch("app.api.dependencies.check_dependencies", return_value=[]) as mock_check:
        r = client.post("/api/dependencies/recheck")
    assert r.status_code == 200
    mock_check.assert_called_once()
