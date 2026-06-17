import contextlib
import hashlib
import json
import os
import shutil
import tempfile
from collections import defaultdict
from datetime import datetime

from sqlalchemy import delete as sa_delete
from sqlalchemy import insert as sa_insert
from sqlalchemy import update
from sqlmodel import Session, select

from app.core.runner import SubprocessRunner
from app.models.device import Device
from app.models.duplicate_group import DuplicateGroup
from app.models.enums import FileStatus, JobStatus
from app.models.file_entry import FileEntry
from app.models.job import Job


async def run_catalog(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    """
    Two-pass catalog:
    1. os.walk to enumerate all files and insert FileEntry rows with basic metadata.
    2. czkawka_cli dup --json to get SHA256 hashes + duplicate groups;
       update existing rows and create DuplicateGroup records.
    Falls back to Python hashlib for hashing if czkawka_cli is not available.
    """
    source_path = device.source_path or device.staging_path
    if not source_path:
        await _fail_job(session, job_id, "Device has no source_path or staging_path")
        return

    if not os.path.isdir(source_path):
        await _fail_job(session, job_id, f"Source path is not accessible: {source_path}")
        return

    log_path = runner.log_path_for(job_id)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    # Pass 1 — enumerate all files via os.walk and bulk-insert FileEntry rows
    entries = []
    try:
        with open(log_path, "a", buffering=1) as log_file:
            log_file.write(f"[{datetime.utcnow().isoformat()}] START: catalog {source_path}\n")
            log_file.write(f"[{datetime.utcnow().isoformat()}] PASS 1: enumerating files\n")

            for dirpath, _dirnames, filenames in os.walk(source_path):
                for fname in filenames:
                    full_path = os.path.join(dirpath, fname)
                    try:
                        stat = os.stat(full_path)
                    except OSError:
                        continue
                    entries.append(
                        {
                            "device_id": device.id,
                            "path": full_path,
                            "relative_path": os.path.relpath(full_path, source_path),
                            "size_bytes": stat.st_size,
                            "sha256": "",
                            "mime_type": None,
                            "mtime": datetime.fromtimestamp(stat.st_mtime),
                            "status": FileStatus.pending,
                            "duplicate_group_id": None,
                            "restic_snapshot_id": None,
                        }
                    )

            log_file.write(
                f"[{datetime.utcnow().isoformat()}] PASS 1: found {len(entries)} files\n"
            )
    except OSError as e:
        await _fail_job(session, job_id, f"Source path became inaccessible during catalog: {e}")
        return

    # Delete old entries for re-catalog, then bulk insert
    session.execute(sa_delete(FileEntry).where(FileEntry.device_id == device.id))
    if entries:
        session.execute(sa_insert(FileEntry), entries)
    session.commit()

    # Pass 2 — hash files and detect duplicates
    use_czkawka = shutil.which("czkawka_cli") is not None

    if use_czkawka:
        await _run_czkawka_pass(job_id, device, session, runner, source_path)
    else:
        await _python_hash_pass(job_id, device, session, runner, source_path)


async def _run_czkawka_pass(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
    source_path: str,
) -> None:
    # czkawka >=11 writes JSON to a file (no --json stdout flag).
    # Exit code 11 means "duplicates found" — not an error; -W suppresses it.
    fd, json_path = tempfile.mkstemp(suffix=".json", prefix="czkawka_")
    os.close(fd)
    try:
        cmd = [
            "czkawka_cli",
            "dup",
            "--directories",
            source_path,
            "--compact-file-to-save",
            json_path,
            "--minimal-file-size",
            "1",
            "--do-not-print-results",
            "--ignore-error-code-on-found",
        ]

        async for _line in runner.run(job_id, cmd):
            pass

        try:
            with open(json_path) as fh:
                raw = fh.read().strip()
        except OSError:
            return

        if not raw:
            return

        try:
            # v11 format: {"<size_key>": [[{path, size, hash, modified_date}, ...], ...], ...}
            data = json.loads(raw)
        except json.JSONDecodeError:
            return

        # Flatten the size-keyed dict into a single list of groups
        dup_groups = [group for groups in data.values() for group in groups]
        _apply_czkawka_results(dup_groups, device, session)
    finally:
        with contextlib.suppress(OSError):
            os.unlink(json_path)


def _create_dup_group(
    content_hash: str,
    total_bytes: int,
    entry_ids: list[int],
    session: Session,
    extra_values: dict | None = None,
) -> None:
    """Insert one DuplicateGroup and link the given FileEntry IDs to it."""
    dup_group = DuplicateGroup(content_hash=content_hash, total_size_bytes=total_bytes)
    session.add(dup_group)
    session.flush()
    for fid in entry_ids:
        vals = {"duplicate_group_id": dup_group.id, **(extra_values or {})}
        session.execute(update(FileEntry).where(FileEntry.id == fid).values(**vals))


def _apply_czkawka_results(dup_groups, device: Device, session: Session) -> None:
    rows = session.exec(select(FileEntry).where(FileEntry.device_id == device.id)).all()
    path_index: dict[str, int] = {r.path: r.id for r in rows}

    for group in dup_groups:
        if not group:
            continue
        content_hash = group[0].get("hash", "")
        total_size = sum(f.get("size", 0) for f in group)
        entry_ids = [fid for fi in group if (fid := path_index.get(fi["path"])) is not None]
        _create_dup_group(content_hash, total_size, entry_ids, session, {"sha256": content_hash})

    session.commit()


async def _python_hash_pass(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
    source_path: str,
) -> None:
    """Compute SHA256 for every file using Python when czkawka_cli is unavailable."""
    log_path = runner.log_path_for(job_id)
    rows = session.exec(select(FileEntry).where(FileEntry.device_id == device.id)).all()

    await runner._set_status(job_id, JobStatus.in_progress)

    with open(log_path, "a", buffering=1) as log_file:
        log_file.write(
            f"[{datetime.utcnow().isoformat()}] PASS 2: czkawka_cli not found, "
            f"computing SHA256 in Python for {len(rows)} files\n"
        )
        for i, row in enumerate(rows):
            try:
                sha = _sha256_file(row.path)
            except OSError:
                sha = ""
            session.execute(update(FileEntry).where(FileEntry.id == row.id).values(sha256=sha))
            if i % 1000 == 0 and i > 0:
                session.commit()
                log_file.write(f"[{datetime.utcnow().isoformat()}] hashed {i}/{len(rows)} files\n")

        session.commit()
        log_file.write(f"[{datetime.utcnow().isoformat()}] PASS 2: hashing complete\n")

    _build_duplicate_groups_from_hashes(device, session)

    with open(log_path, "a") as log_file:
        log_file.write(f"[{datetime.utcnow().isoformat()}] EXIT: 0\n")

    await runner._set_status(job_id, JobStatus.completed, exit_code=0)


def _build_duplicate_groups_from_hashes(device: Device, session: Session) -> None:
    rows = session.exec(select(FileEntry).where(FileEntry.device_id == device.id)).all()

    by_hash: dict[str, list] = defaultdict(list)
    for row in rows:
        if row.sha256:
            by_hash[row.sha256].append(row)

    for content_hash, members in by_hash.items():
        if len(members) < 2:
            continue
        total_size = sum(m.size_bytes for m in members)
        entry_ids = [m.id for m in members if m.id is not None]
        _create_dup_group(content_hash, total_size, entry_ids, session)

    session.commit()


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


async def _fail_job(session: Session, job_id: int, message: str) -> None:
    job = session.get(Job, job_id)
    if job:
        job.status = JobStatus.failed
        job.error_message = message
        job.completed_at = datetime.utcnow()
        session.add(job)
        session.commit()
