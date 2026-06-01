"""Tests for duplicate-groups API: list, resolve, auto-resolve, stats."""

from datetime import datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.conftest import make_device


def _seed_group(session: Session, device_id: int) -> tuple:
    """Seed one DuplicateGroup with two FileEntry members."""
    from app.models.duplicate_group import DuplicateGroup
    from app.models.enums import FileStatus
    from app.models.file_entry import FileEntry

    grp = DuplicateGroup(content_hash="abc" * 21 + "d", total_size_bytes=200)
    session.add(grp)
    session.flush()

    entries = []
    for i in range(2):
        e = FileEntry(
            device_id=device_id,
            path=f"/data/dup{i}.txt",
            relative_path=f"dup{i}.txt",
            size_bytes=100,
            sha256=grp.content_hash,
            mtime=datetime.utcnow(),
            status=FileStatus.pending,
            duplicate_group_id=grp.id,
        )
        session.add(e)
        entries.append(e)
    session.commit()
    session.refresh(grp)
    for e in entries:
        session.refresh(e)
    return grp, entries


def test_list_groups_empty(client: TestClient, session: Session) -> None:
    d = make_device(session)
    r = client.get(f"/api/duplicate-groups?device_id={d.id}")
    assert r.status_code == 200
    assert r.json() == []


def test_list_groups_returns_members(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="cataloged")
    _seed_group(session, d.id)
    r = client.get(f"/api/duplicate-groups?device_id={d.id}")
    assert r.status_code == 200
    groups = r.json()
    assert len(groups) == 1
    assert len(groups[0]["entries"]) == 2


def test_list_groups_triggers_analyzing_stage(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="cataloged")
    _seed_group(session, d.id)
    client.get(f"/api/duplicate-groups?device_id={d.id}")
    r = client.get(f"/api/devices/{d.id}")
    assert r.json()["stage"] == "analyzing"


def test_list_no_groups_advances_to_analyzed(client: TestClient, session: Session) -> None:
    """Device with no duplicate groups goes straight to analyzed."""
    d = make_device(session, stage="cataloged")
    client.get(f"/api/duplicate-groups?device_id={d.id}")
    assert client.get(f"/api/devices/{d.id}").json()["stage"] == "analyzed"


def test_list_filter_resolved(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="cataloged")
    grp, entries = _seed_group(session, d.id)
    # Resolve the group
    client.patch(f"/api/duplicate-groups/{grp.id}", json={"canonical_entry_id": entries[0].id})

    r_unresolved = client.get(f"/api/duplicate-groups?device_id={d.id}&resolved=false")
    assert r_unresolved.json() == []

    r_resolved = client.get(f"/api/duplicate-groups?device_id={d.id}&resolved=true")
    assert len(r_resolved.json()) == 1


def test_resolve_group(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="analyzing")
    grp, entries = _seed_group(session, d.id)
    canonical_id = entries[0].id

    r = client.patch(f"/api/duplicate-groups/{grp.id}", json={"canonical_entry_id": canonical_id})
    assert r.status_code == 200
    body = r.json()
    assert body["resolved"] is True
    assert body["canonical_entry_id"] == canonical_id


def test_resolve_advances_to_analyzed(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="analyzing")
    grp, entries = _seed_group(session, d.id)
    client.patch(f"/api/duplicate-groups/{grp.id}", json={"canonical_entry_id": entries[0].id})
    assert client.get(f"/api/devices/{d.id}").json()["stage"] == "analyzed"


def test_resolve_marks_entries(client: TestClient, session: Session) -> None:
    from app.models.file_entry import FileEntry

    d = make_device(session, stage="analyzing")
    grp, entries = _seed_group(session, d.id)
    canonical_id = entries[0].id
    other_id = entries[1].id

    client.patch(f"/api/duplicate-groups/{grp.id}", json={"canonical_entry_id": canonical_id})

    session.expire_all()
    canonical = session.get(FileEntry, canonical_id)
    other = session.get(FileEntry, other_id)
    assert canonical.status.value == "keep"
    assert other.status.value == "discard"


def test_resolve_group_not_found(client: TestClient) -> None:
    assert (
        client.patch("/api/duplicate-groups/999", json={"canonical_entry_id": 1}).status_code == 404
    )


def test_resolve_bad_canonical(client: TestClient, session: Session) -> None:
    d = make_device(session)
    grp, _ = _seed_group(session, d.id)
    assert (
        client.patch(
            f"/api/duplicate-groups/{grp.id}", json={"canonical_entry_id": 9999}
        ).status_code
        == 404
    )


def test_auto_resolve(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="analyzing")
    _seed_group(session, d.id)
    r = client.post(f"/api/duplicate-groups/{d.id}/auto-resolve")
    assert r.status_code == 200
    assert r.json()["resolved"] == 1
    assert r.json()["remaining"] == 0


def test_auto_resolve_advances_stage(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="analyzing")
    _seed_group(session, d.id)
    client.post(f"/api/duplicate-groups/{d.id}/auto-resolve")
    assert client.get(f"/api/devices/{d.id}").json()["stage"] == "analyzed"


def test_auto_resolve_prefers_deeper_path(client: TestClient, session: Session) -> None:
    from app.models.duplicate_group import DuplicateGroup
    from app.models.enums import FileStatus
    from app.models.file_entry import FileEntry

    d = make_device(session, stage="analyzing")
    grp = DuplicateGroup(content_hash="x" * 64, total_size_bytes=200)
    session.add(grp)
    session.flush()

    shallow = FileEntry(
        device_id=d.id,
        path="/a/file.txt",
        relative_path="a/file.txt",
        size_bytes=100,
        sha256="x" * 64,
        mtime=datetime.utcnow(),
        status=FileStatus.pending,
        duplicate_group_id=grp.id,
    )
    deep = FileEntry(
        device_id=d.id,
        path="/a/b/c/file.txt",
        relative_path="a/b/c/file.txt",
        size_bytes=100,
        sha256="x" * 64,
        mtime=datetime.utcnow(),
        status=FileStatus.pending,
        duplicate_group_id=grp.id,
    )
    session.add_all([shallow, deep])
    session.commit()
    session.refresh(shallow)
    session.refresh(deep)

    client.post(f"/api/duplicate-groups/{d.id}/auto-resolve")

    session.expire_all()
    from app.models.file_entry import FileEntry as FE

    winner = session.get(FE, deep.id)
    loser = session.get(FE, shallow.id)
    assert winner.status.value == "keep"
    assert loser.status.value == "discard"


def test_stats(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="analyzing")
    grp, entries = _seed_group(session, d.id)
    r = client.get(f"/api/duplicate-groups/stats/{d.id}")
    assert r.status_code == 200
    assert r.json() == {"total": 1, "resolved": 0, "unresolved": 1}


def test_stats_after_resolve(client: TestClient, session: Session) -> None:
    d = make_device(session, stage="analyzing")
    grp, entries = _seed_group(session, d.id)
    client.patch(f"/api/duplicate-groups/{grp.id}", json={"canonical_entry_id": entries[0].id})
    r = client.get(f"/api/duplicate-groups/stats/{d.id}")
    assert r.json() == {"total": 1, "resolved": 1, "unresolved": 0}
