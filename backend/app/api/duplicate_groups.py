from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select

from app.core.deps import SessionDep
from app.models.device import Device
from app.models.duplicate_group import DuplicateGroup
from app.models.enums import DeviceStage, FileStatus
from app.models.file_entry import FileEntry

router = APIRouter(prefix="/duplicate-groups", tags=["duplicate-groups"])


class FileEntryBrief(BaseModel):
    id: int
    path: str
    relative_path: str
    size_bytes: int
    mtime: datetime
    device_id: int
    status: FileStatus

    model_config = {"from_attributes": True}


class DuplicateGroupRead(BaseModel):
    id: int
    content_hash: str
    canonical_entry_id: int | None
    resolved: bool
    auto_resolved: bool
    total_size_bytes: int
    entries: list[FileEntryBrief]

    model_config = {"from_attributes": True}


class ResolveBody(BaseModel):
    canonical_entry_id: int


@router.get("", response_model=list[DuplicateGroupRead])
def list_duplicate_groups(
    session: SessionDep,
    device_id: int = Query(...),
    resolved: bool | None = Query(None),
):
    # Fetch groups whose entries include this device
    entry_stmt = (
        select(FileEntry.duplicate_group_id)
        .where(
            FileEntry.device_id == device_id,
            FileEntry.duplicate_group_id.is_not(None),
        )
        .distinct()
    )
    group_ids = [r for r in session.exec(entry_stmt).all() if r is not None]

    # Advance device stage to analyzing when user first opens the resolver
    device = session.get(Device, device_id)
    if device and device.stage == DeviceStage.cataloged:
        device.stage = DeviceStage.analyzing
        device.updated_at = datetime.utcnow()
        session.add(device)
        session.commit()

    if not group_ids:
        # No duplicate groups — jump straight to analyzed
        if device and device.stage == DeviceStage.analyzing:
            device.stage = DeviceStage.analyzed
            device.updated_at = datetime.utcnow()
            session.add(device)
            session.commit()
        return []

    stmt = select(DuplicateGroup).where(DuplicateGroup.id.in_(group_ids))
    if resolved is not None:
        stmt = stmt.where(DuplicateGroup.resolved == resolved)

    groups = session.exec(stmt).all()

    result = []
    for g in groups:
        entries = session.exec(select(FileEntry).where(FileEntry.duplicate_group_id == g.id)).all()
        result.append(
            DuplicateGroupRead(
                id=g.id,
                content_hash=g.content_hash,
                canonical_entry_id=g.canonical_entry_id,
                resolved=g.resolved,
                auto_resolved=g.auto_resolved,
                total_size_bytes=g.total_size_bytes,
                entries=[FileEntryBrief.model_validate(e) for e in entries],
            )
        )

    return result


@router.patch("/{group_id}", response_model=DuplicateGroupRead)
def resolve_group(group_id: int, body: ResolveBody, session: SessionDep):
    group = session.get(DuplicateGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    canonical = session.get(FileEntry, body.canonical_entry_id)
    if not canonical:
        raise HTTPException(status_code=404, detail="Canonical entry not found")

    group.canonical_entry_id = body.canonical_entry_id
    group.resolved = True
    session.add(group)

    # Mark canonical as keep, rest as discard
    entries = session.exec(select(FileEntry).where(FileEntry.duplicate_group_id == group_id)).all()
    for entry in entries:
        entry.status = (
            FileStatus.keep if entry.id == body.canonical_entry_id else FileStatus.discard
        )
        session.add(entry)

    session.commit()
    session.refresh(group)

    # If all groups for this device are now resolved, advance stage to analyzed
    device_id = canonical.device_id
    all_group_ids_stmt = (
        select(FileEntry.duplicate_group_id)
        .where(
            FileEntry.device_id == device_id,
            FileEntry.duplicate_group_id.is_not(None),
        )
        .distinct()
    )
    all_ids = [r for r in session.exec(all_group_ids_stmt).all() if r is not None]
    unresolved = session.exec(
        select(DuplicateGroup).where(
            DuplicateGroup.id.in_(all_ids),
            DuplicateGroup.resolved == False,  # noqa: E712
        )
    ).all()
    if not unresolved:
        device = session.get(Device, device_id)
        if device and device.stage == DeviceStage.analyzing:
            device.stage = DeviceStage.analyzed
            device.updated_at = datetime.utcnow()
            session.add(device)
            session.commit()

    return DuplicateGroupRead(
        id=group.id,
        content_hash=group.content_hash,
        canonical_entry_id=group.canonical_entry_id,
        resolved=group.resolved,
        auto_resolved=group.auto_resolved,
        total_size_bytes=group.total_size_bytes,
        entries=[FileEntryBrief.model_validate(e) for e in entries],
    )


@router.post("/{device_id}/auto-resolve", status_code=200)
def auto_resolve(device_id: int, session: SessionDep):
    """
    Auto-resolve all unresolved duplicate groups for a device.
    Rules (in order of priority):
    1. Longest path depth (most organized location)
    2. Newest mtime
    3. Lowest device_id (earlier-registered device)
    """
    entry_stmt = (
        select(FileEntry.duplicate_group_id)
        .where(
            FileEntry.device_id == device_id,
            FileEntry.duplicate_group_id.is_not(None),
        )
        .distinct()
    )
    group_ids = [r for r in session.exec(entry_stmt).all() if r is not None]

    unresolved = session.exec(
        select(DuplicateGroup).where(
            DuplicateGroup.id.in_(group_ids),
            DuplicateGroup.resolved == False,  # noqa: E712
        )
    ).all()

    resolved_count = 0
    for group in unresolved:
        entries = session.exec(
            select(FileEntry).where(FileEntry.duplicate_group_id == group.id)
        ).all()
        if not entries:
            continue

        winner = max(
            entries,
            key=lambda e: (
                e.path.count("/"),  # deeper path = more organized
                e.mtime.timestamp(),  # newer mtime
                -e.device_id,  # lower device_id wins (negate for max)
            ),
        )

        group.canonical_entry_id = winner.id
        group.resolved = True
        group.auto_resolved = True
        session.add(group)

        for entry in entries:
            entry.status = FileStatus.keep if entry.id == winner.id else FileStatus.discard
            session.add(entry)

        resolved_count += 1

    session.commit()

    # Check if all groups for this device are now resolved → advance to analyzed
    all_group_ids = [r for r in session.exec(entry_stmt).all() if r is not None]
    unresolved_count = session.exec(
        select(DuplicateGroup).where(
            DuplicateGroup.id.in_(all_group_ids),
            DuplicateGroup.resolved == False,  # noqa: E712
        )
    ).all()

    if not unresolved_count:
        device = session.get(Device, device_id)
        if device and device.stage in (DeviceStage.analyzing, DeviceStage.cataloged):
            device.stage = DeviceStage.analyzed
            device.updated_at = datetime.utcnow()
            session.add(device)
            session.commit()

    return {"resolved": resolved_count, "remaining": len(unresolved_count)}


@router.get("/stats/{device_id}")
def group_stats(device_id: int, session: SessionDep):
    """Summary counts for the duplicate resolver progress bar."""
    entry_stmt = (
        select(FileEntry.duplicate_group_id)
        .where(
            FileEntry.device_id == device_id,
            FileEntry.duplicate_group_id.is_not(None),
        )
        .distinct()
    )
    group_ids = [r for r in session.exec(entry_stmt).all() if r is not None]

    if not group_ids:
        return {"total": 0, "resolved": 0, "unresolved": 0}

    all_groups = session.exec(select(DuplicateGroup).where(DuplicateGroup.id.in_(group_ids))).all()
    total = len(all_groups)
    resolved = sum(1 for g in all_groups if g.resolved)
    return {"total": total, "resolved": resolved, "unresolved": total - resolved}
