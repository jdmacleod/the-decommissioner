import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from app.core.deps import SessionDep
from app.models.storage_target import (
    StorageTarget,
    StorageTargetCreate,
    StorageTargetRead,
    StorageTargetUpdate,
)

router = APIRouter(prefix="/storage-targets", tags=["storage-targets"])


@router.get("", response_model=list[StorageTargetRead])
def list_targets(session: SessionDep) -> list[StorageTarget]:
    return list(session.exec(select(StorageTarget)).all())


@router.post("", response_model=StorageTargetRead, status_code=201)
def create_target(body: StorageTargetCreate, session: SessionDep) -> StorageTarget:
    if body.is_default:
        _clear_defaults(session)
    target = StorageTarget.model_validate(body)
    session.add(target)
    session.commit()
    session.refresh(target)
    return target


@router.patch("/{target_id}", response_model=StorageTargetRead)
def update_target(target_id: int, body: StorageTargetUpdate, session: SessionDep) -> StorageTarget:
    target = session.get(StorageTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Storage target not found")
    if body.is_default:
        _clear_defaults(session, exclude_id=target_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(target, field, value)
    session.add(target)
    session.commit()
    session.refresh(target)
    return target


@router.delete("/{target_id}", status_code=204)
def delete_target(target_id: int, session: SessionDep) -> None:
    target = session.get(StorageTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Storage target not found")
    session.delete(target)
    session.commit()


@router.post("/{target_id}/test")
def test_target(target_id: int, session: SessionDep) -> dict[str, object]:
    target = session.get(StorageTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Storage target not found")
    merged_env = {
        **os.environ,
        target.restic_password_env: os.environ.get(target.restic_password_env, ""),
    }
    result = subprocess.run(
        ["restic", "snapshots", "--repo", target.path, "--json"],
        capture_output=True,
        text=True,
        env=merged_env,
        timeout=30,
    )
    return {
        "ok": result.returncode == 0,
        "output": (result.stdout or result.stderr).strip(),
    }


@router.post("/{target_id}/init")
def init_target(target_id: int, session: SessionDep) -> dict[str, object]:
    target = session.get(StorageTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Storage target not found")
    merged_env = {
        **os.environ,
        target.restic_password_env: os.environ.get(target.restic_password_env, ""),
    }
    result = subprocess.run(
        ["restic", "init", "--repo", target.path],
        capture_output=True,
        text=True,
        env=merged_env,
        timeout=60,
    )
    if result.returncode == 0:
        target.initialized = True
        session.add(target)
        session.commit()
    return {
        "ok": result.returncode == 0,
        "output": (result.stdout or result.stderr).strip(),
    }


@router.get("/list-dirs")
def list_dirs(path: str = Query(default="/")) -> dict[str, object]:
    """Return immediate subdirectories of a server filesystem path."""
    base = Path(path).expanduser().resolve()
    if not base.exists() or not base.is_dir():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    try:
        entries = sorted(
            ({"name": d.name, "path": str(d)} for d in base.iterdir() if d.is_dir() and not d.name.startswith(".")),
            key=lambda e: e["name"].lower(),
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    parent = str(base.parent) if base.parent != base else None
    return {"path": str(base), "parent": parent, "entries": entries}


def _clear_defaults(session: SessionDep, exclude_id: int | None = None) -> None:
    existing = session.exec(select(StorageTarget).where(StorageTarget.is_default == True)).all()  # noqa: E712
    for t in existing:
        if t.id != exclude_id:
            t.is_default = False
            session.add(t)
