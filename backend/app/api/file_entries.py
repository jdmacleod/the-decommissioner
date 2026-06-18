from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlmodel import func, select

from app.core.deps import SessionDep
from app.models.enums import FileStatus
from app.models.file_entry import FileEntry

router = APIRouter(prefix="/file-entries", tags=["file-entries"])


class FileEntryRead(BaseModel):
    id: int
    device_id: int
    path: str
    relative_path: str
    size_bytes: int
    sha256: str
    mime_type: str | None
    status: FileStatus
    duplicate_group_id: int | None

    model_config = {"from_attributes": True}


class FileEntryPage(BaseModel):
    items: list[FileEntryRead]
    total: int
    total_bytes: int
    page: int
    limit: int


class BulkStatusUpdate(BaseModel):
    updates: list[dict]  # [{id: int, status: str}]


@router.get("", response_model=FileEntryPage)
def list_file_entries(
    session: SessionDep,
    device_id: int = Query(...),
    page: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    status: FileStatus | None = Query(None),
    search: str | None = Query(None),
):
    stmt = select(FileEntry).where(FileEntry.device_id == device_id)

    if status is not None:
        stmt = stmt.where(FileEntry.status == status)
    if search:
        stmt = stmt.where(FileEntry.path.contains(search))

    subq = stmt.subquery()
    agg = session.exec(
        select(func.count(), func.coalesce(func.sum(subq.c.size_bytes), 0)).select_from(subq)
    ).one()
    total, total_bytes = int(agg[0]), int(agg[1])

    items = session.exec(stmt.offset(page * limit).limit(limit)).all()

    return FileEntryPage(items=items, total=total, total_bytes=total_bytes, page=page, limit=limit)


class StatusPatch(BaseModel):
    id: int
    status: FileStatus


@router.patch("", status_code=200)
def bulk_update_status(body: list[StatusPatch], session: SessionDep):
    if not body:
        return {"updated": 0}

    ids = [u.id for u in body]
    rows = session.exec(select(FileEntry).where(FileEntry.id.in_(ids))).all()
    index = {r.id: r for r in rows}

    for patch in body:
        row = index.get(patch.id)
        if row:
            row.status = patch.status
            session.add(row)

    session.commit()
    return {"updated": len(rows)}
