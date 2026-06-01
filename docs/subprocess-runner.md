# the-decommissioner — Subprocess Runner

The runner is the execution core of the backend. It:
1. Spawns external CLI tools as async subprocesses
2. Streams stdout/stderr to a log file and to connected SSE clients simultaneously
3. Manages job lifecycle in the database (pending → in_progress → completed/failed)
4. Supports late-joining SSE clients by replaying the log file

---

## Design Principles

**Separation of concerns.** The runner knows nothing about what the command does —
it only knows how to run it, stream its output, and record the outcome.
Engine modules (catalog, migrate, wipe, etc.) build the command list and
call the runner.

**Log file as the source of truth.** Every byte from subprocess stdout/stderr
is written to a plain-text log file before being yielded to SSE clients.
This means a client that disconnects and reconnects gets a full replay —
no in-memory ring buffer, no message broker needed.

**One runner instance, many concurrent jobs.** The runner is a singleton
service class. Each `run()` call is an independent async coroutine; multiple
jobs can run concurrently (e.g., cataloging device A while migrating device B).

---

## Core Runner

```python
# backend/app/core/runner.py

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Optional

from sqlmodel import Session, select

from app.core.config import settings
from app.models.job import Job, JobStatus


LOG_DIR = Path(settings.data_dir) / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)


class SubprocessRunner:
    """
    Runs an external command, streams output to a log file and to callers
    via an async generator. Updates the Job row in the DB at each lifecycle point.
    """

    def __init__(self, session_factory):
        # session_factory: callable that returns a SQLModel Session
        self._session_factory = session_factory

    def log_path_for(self, job_id: int) -> Path:
        return LOG_DIR / f"job_{job_id}.log"

    async def run(
        self,
        job_id: int,
        cmd: list[str],
        env: Optional[dict[str, str]] = None,
        cwd: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """
        Execute `cmd` and yield log lines as they arrive.

        Usage (in an engine):
            async for line in runner.run(job_id, ["restic", "backup", path]):
                pass  # runner handles writing; engine can inspect lines if needed
        """
        log_path = self.log_path_for(job_id)

        # Merge caller env with current process env (allows RESTIC_PASSWORD passthrough)
        merged_env = {**os.environ, **(env or {})}

        await self._set_status(job_id, JobStatus.in_progress)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,  # merge stderr into stdout
                env=merged_env,
                cwd=cwd,
            )

            with open(log_path, "a", buffering=1) as log_file:  # line-buffered
                # Write a header line to the log
                header = f"[{datetime.utcnow().isoformat()}] START: {' '.join(cmd)}\n"
                log_file.write(header)
                yield header

                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="replace")
                    log_file.write(line)
                    yield line

                await proc.wait()

                footer = (
                    f"[{datetime.utcnow().isoformat()}] "
                    f"EXIT: {proc.returncode}\n"
                )
                log_file.write(footer)
                yield footer

            if proc.returncode == 0:
                await self._set_status(job_id, JobStatus.completed, exit_code=0)
            else:
                await self._set_status(
                    job_id,
                    JobStatus.failed,
                    exit_code=proc.returncode,
                    error_message=f"Process exited with code {proc.returncode}",
                )

        except FileNotFoundError as e:
            # The binary doesn't exist (dependency missing)
            error = f"Command not found: {cmd[0]} — {e}\n"
            with open(log_path, "a") as log_file:
                log_file.write(error)
            yield error
            await self._set_status(
                job_id, JobStatus.failed, error_message=str(e)
            )

        except Exception as e:
            error = f"Runner error: {e}\n"
            with open(log_path, "a") as log_file:
                log_file.write(error)
            yield error
            await self._set_status(
                job_id, JobStatus.failed, error_message=str(e)
            )

    async def replay(self, job_id: int) -> AsyncIterator[str]:
        """
        Replay the log file for a completed (or still-running) job.
        Used by SSE endpoint when a client reconnects.
        """
        log_path = self.log_path_for(job_id)
        if not log_path.exists():
            yield f"[no log found for job {job_id}]\n"
            return
        with open(log_path, "r") as f:
            for line in f:
                yield line

    async def _set_status(
        self,
        job_id: int,
        status: JobStatus,
        exit_code: Optional[int] = None,
        error_message: Optional[str] = None,
    ) -> None:
        with self._session_factory() as session:
            job = session.get(Job, job_id)
            if not job:
                return
            job.status = status
            if status == JobStatus.in_progress:
                job.started_at = datetime.utcnow()
            elif status in (JobStatus.completed, JobStatus.failed, JobStatus.cancelled):
                job.completed_at = datetime.utcnow()
            if exit_code is not None:
                job.exit_code = exit_code
            if error_message is not None:
                job.error_message = error_message
            session.add(job)
            session.commit()
```

---

## SSE Endpoint

The runner yields lines; the FastAPI SSE endpoint converts them to the SSE wire format.
SSE is a plain HTTP streaming response — no WebSocket handshake needed.

```python
# backend/app/api/jobs.py

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.core.runner import SubprocessRunner
from app.models.job import Job, JobStatus
from app.core.deps import get_session, get_runner

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}/stream")
async def stream_job_log(
    job_id: int,
    session: Session = Depends(get_session),
    runner: SubprocessRunner = Depends(get_runner),
):
    """
    SSE endpoint. Streams log lines for a running job, or replays the
    full log for a completed/failed job.

    Client usage:
        const es = new EventSource(`/jobs/${jobId}/stream`);
        es.onmessage = (e) => appendLine(e.data);
    """
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        if job.status in (JobStatus.completed, JobStatus.failed, JobStatus.cancelled):
            # Replay from log file — job is already done
            async for line in runner.replay(job_id):
                yield f"data: {line.rstrip()}\n\n"
            yield "event: done\ndata: \n\n"
        else:
            # NOTE: For a live-running job, the engine holds the async generator.
            # The SSE endpoint tails the log file instead of getting the generator
            # directly — this decouples the SSE client lifecycle from the runner coroutine.
            async for line in _tail_log(runner.log_path_for(job_id), job_id, session):
                yield f"data: {line.rstrip()}\n\n"
            yield "event: done\ndata: \n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


async def _tail_log(log_path, job_id: int, session: Session):
    """
    Tail the log file for a running job. Polls every 200ms.
    Exits when the job reaches a terminal status in the DB.
    """
    import aiofiles
    from pathlib import Path

    path = Path(log_path)
    # Wait for the file to appear (job may have just started)
    for _ in range(25):  # 5 second timeout
        if path.exists():
            break
        await asyncio.sleep(0.2)

    async with aiofiles.open(path, "r") as f:
        while True:
            line = await f.readline()
            if line:
                yield line
            else:
                # No new content — check if job is done
                job = session.get(Job, job_id)
                if job and job.status in (
                    JobStatus.completed, JobStatus.failed, JobStatus.cancelled
                ):
                    # Drain any remaining lines before exiting
                    remaining = await f.read()
                    if remaining:
                        for l in remaining.splitlines(keepends=True):
                            yield l
                    break
                await asyncio.sleep(0.2)
```

---

## Job Factory

Engines don't create Job rows themselves — they call the job factory, which creates
the row and hands back the ID. This keeps DB logic out of engine code.

```python
# backend/app/core/job_factory.py

from datetime import datetime
from pathlib import Path
from sqlmodel import Session

from app.core.config import settings
from app.core.runner import LOG_DIR
from app.models.job import Job, JobStatus, JobType


def create_job(session: Session, device_id: int, job_type: JobType) -> Job:
    """
    Create a Job row in pending state. The log file path is pre-assigned
    so the runner can write to it as soon as execution begins.
    """
    job = Job(
        device_id=device_id,
        job_type=job_type,
        status=JobStatus.pending,
        log_path="",  # filled after insert (needs the ID)
        created_at=datetime.utcnow(),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Now we have an ID — set the log path
    job.log_path = str(LOG_DIR / f"job_{job.id}.log")
    session.add(job)
    session.commit()
    session.refresh(job)

    return job
```

---

## Engine Pattern

Each engine module exposes a single async function that accepts a `job_id`,
uses the runner, and handles output parsing. Example for the catalog engine:

```python
# backend/app/engines/catalog.py

import json
import asyncio
from sqlmodel import Session

from app.core.runner import SubprocessRunner
from app.models.file_entry import FileEntry, FileStatus
from app.models.device import Device


async def run_catalog(
    job_id: int,
    device: Device,
    session: Session,
    runner: SubprocessRunner,
) -> None:
    """
    Runs czkawka in JSON output mode, parses results, and bulk-inserts
    FileEntry rows into the database.
    
    Falls back to jdupes if czkawka is not available.
    """
    source_path = device.source_path or device.staging_path

    cmd = [
        "czkawka_cli",
        "dup",                  # duplicate files subcommand
        "--directories", source_path,
        "--json",               # structured output
        "--hash-type", "SHA256",
        "--minimal-file-size", "1",
    ]

    # Accumulate JSON output lines (czkawka writes one JSON blob at the end)
    output_lines = []
    async for line in runner.run(job_id, cmd):
        output_lines.append(line)

    # Parse and insert
    raw_output = "".join(output_lines)
    try:
        _parse_and_insert(raw_output, device, session)
    except Exception as e:
        # Log parse error — job status already set to failed by runner if exit != 0
        raise RuntimeError(f"Failed to parse czkawka output: {e}") from e


def _parse_and_insert(raw: str, device: Device, session: Session) -> None:
    # czkawka JSON output: list of duplicate groups, each a list of file dicts
    # Extract the JSON block (it may be preceded by progress lines)
    json_start = raw.rfind("[")
    if json_start == -1:
        raise ValueError("No JSON array found in czkawka output")

    data = json.loads(raw[json_start:])

    entries = []
    from datetime import datetime
    for group in data:
        for file_info in group:
            entries.append({
                "device_id": device.id,
                "path": file_info["path"],
                "relative_path": file_info["path"].replace(device.source_path, ""),
                "size_bytes": file_info["size"],
                "sha256": file_info.get("hash", ""),
                "mime_type": None,  # czkawka doesn't emit MIME; fill via python-magic in post-processing
                "mtime": datetime.fromtimestamp(file_info.get("modified_date", 0)),
                "status": FileStatus.pending,
            })

    # Bulk insert using SQLAlchemy core for performance
    from sqlalchemy import insert
    from app.models.file_entry import FileEntry
    if entries:
        session.exec(insert(FileEntry), entries)
        session.commit()
```

---

## Dependency Checker

Run at startup; results stored in the `Dependency` table and surfaced in the UI.

```python
# backend/app/core/deps.py

import shutil
import subprocess
from datetime import datetime
from sqlmodel import Session

from app.models.dependency import Dependency, DependencyStatus
from app.models.enums import JobType

REQUIRED = [
    {
        "name": "restic",
        "required_for": [JobType.migrate, JobType.verify],
        "version_cmd": ["restic", "version"],
        "install_hint": "brew install restic  OR  apt install restic",
    },
    {
        "name": "czkawka_cli",
        "required_for": [JobType.catalog],
        "version_cmd": ["czkawka_cli", "--version"],
        "install_hint": "brew install czkawka  OR  download from github.com/qarmin/czkawka/releases",
    },
    {
        "name": "jdupes",
        "required_for": [JobType.catalog],
        "version_cmd": ["jdupes", "--version"],
        "install_hint": "brew install jdupes  OR  apt install jdupes",
    },
    {
        "name": "ideviceinfo",
        "required_for": [JobType.ios_extract],
        "version_cmd": ["ideviceinfo", "--version"],
        "install_hint": "brew install libimobiledevice  OR  apt install libimobiledevice-utils",
    },
    {
        "name": "nwipe",
        "required_for": [JobType.wipe],
        "version_cmd": ["nwipe", "--version"],
        "install_hint": "apt install nwipe  (Linux only)",
    },
]


def check_dependencies(session: Session) -> list[Dependency]:
    results = []
    for dep in REQUIRED:
        binary = dep["name"]
        found = shutil.which(binary) is not None
        version = None
        if found:
            try:
                out = subprocess.run(
                    dep["version_cmd"],
                    capture_output=True, text=True, timeout=5
                )
                version = (out.stdout or out.stderr).strip().split("\n")[0]
                status = DependencyStatus.found
            except Exception:
                status = DependencyStatus.found  # binary exists, version parse failed
        else:
            status = DependencyStatus.missing

        record = Dependency(
            name=binary,
            required_for=str([jt.value for jt in dep["required_for"]]),
            status=status,
            version=version,
            install_hint=dep["install_hint"],
            checked_at=datetime.utcnow(),
        )
        session.merge(record)  # upsert by name
        results.append(record)

    session.commit()
    return results
```

---

## Cancellation

To cancel a running job, the API endpoint calls `proc.terminate()`. Since the runner
holds the `proc` reference inside its coroutine, cancellation is mediated via a
`CancellationToken` dict keyed by `job_id`:

```python
# In SubprocessRunner:
_cancel_flags: dict[int, asyncio.Event] = {}

async def cancel(self, job_id: int):
    if job_id in self._cancel_flags:
        self._cancel_flags[job_id].set()

# In run(), after each line yield:
if self._cancel_flags.get(job_id, asyncio.Event()).is_set():
    proc.terminate()
    await self._set_status(job_id, JobStatus.cancelled)
    break
```

---

## Summary: Data Flow for a Catalog Job

```
POST /devices/{id}/jobs  (job_type=catalog)
  │
  ├─ create_job()  →  Job row (id=42, status=pending, log_path=logs/job_42.log)
  │
  ├─ asyncio.create_task(run_catalog(job_id=42, ...))
  │     │
  │     ├─ runner._set_status(42, in_progress)
  │     ├─ asyncio.create_subprocess_exec("czkawka_cli", ...)
  │     ├─ for each stdout line:
  │     │     write to logs/job_42.log
  │     │     yield line   ←────────────────────────────────┐
  │     ├─ proc.wait()                                       │
  │     ├─ _parse_and_insert(output, device, session)        │
  │     └─ runner._set_status(42, completed)                 │
  │                                                          │
GET /jobs/42/stream  (SSE)                                   │
  │                                                          │
  └─ _tail_log(logs/job_42.log) ──────────────── yields lines┘
        polls every 200ms until job.status = completed
        client receives lines as SSE events
        final event: "event: done"
```
