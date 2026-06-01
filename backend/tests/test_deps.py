"""Tests for dependency checker."""

from unittest.mock import patch

from sqlmodel import Session, select

from app.core.deps import check_dependencies
from app.models.dependency import Dependency
from app.models.enums import DependencyStatus


def test_check_dependencies_returns_list(session: Session) -> None:
    results = check_dependencies(session)
    assert isinstance(results, list)
    assert len(results) > 0


def test_check_dependencies_known_tools(session: Session) -> None:
    results = check_dependencies(session)
    names = {r.name for r in results}
    assert "restic" in names
    assert "czkawka_cli" in names


def test_check_dependencies_found_tool(session: Session) -> None:
    # "echo" is always available — patch shutil.which to return it for restic
    with (
        patch("app.core.deps.shutil.which", return_value="/usr/bin/echo"),
        patch("app.core.deps.subprocess.run") as mock_run,
    ):
        mock_run.return_value.stdout = "restic 0.16.0\n"
        mock_run.return_value.stderr = ""
        results = check_dependencies(session)

    found = [r for r in results if r.status == DependencyStatus.found]
    assert len(found) > 0


def test_check_dependencies_missing_tool(session: Session) -> None:
    with patch("app.core.deps.shutil.which", return_value=None):
        results = check_dependencies(session)

    assert all(r.status == DependencyStatus.missing for r in results)


def test_check_dependencies_persisted(session: Session) -> None:
    check_dependencies(session)
    rows = session.exec(select(Dependency)).all()
    assert len(rows) > 0


def test_check_dependencies_upserts(session: Session) -> None:
    check_dependencies(session)
    check_dependencies(session)  # second run — should not duplicate rows
    rows = session.exec(select(Dependency)).all()
    names = [r.name for r in rows]
    # No duplicate names
    assert len(names) == len(set(names))
