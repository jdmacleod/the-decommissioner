import asyncio
import json
from pathlib import Path

import aiofiles
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.deps import SessionDep, get_runner
from app.models.enums import JobStatus
from app.models.job import Job, JobRead

router = APIRouter(prefix="/jobs", tags=["jobs"])

TERMINAL_STATUSES = {JobStatus.completed, JobStatus.failed, JobStatus.cancelled}


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: int, session: SessionDep):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/{job_id}/stream")
async def stream_job_log(job_id: int, request: Request, session: SessionDep):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    runner = get_runner(request)

    def _sse_line(line: str) -> str:
        if line.startswith("PROGRESS:"):
            return f"event: progress\ndata: {line[9:].rstrip()}\n\n"
        return f"data: {line.rstrip()}\n\n"

    async def event_generator():
        if job.status in TERMINAL_STATUSES:
            async for line in runner.replay(job_id):
                yield _sse_line(line)
            yield "event: done\ndata: \n\n"
        else:
            async for line in _tail_log(runner.log_path_for(job_id), job_id, session):
                yield _sse_line(line)
            yield "event: done\ndata: \n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{job_id}/cancel", status_code=202)
async def cancel_job(job_id: int, request: Request, session: SessionDep):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.pending, JobStatus.in_progress):
        raise HTTPException(status_code=409, detail="Job is not running")
    runner = get_runner(request)
    await runner.cancel(job_id)
    return {"job_id": job_id, "status": "cancellation_requested"}


class ChecklistItemUpdate(BaseModel):
    index: int
    done: bool


@router.patch("/{job_id}/checklist", response_model=JobRead)
def update_checklist(job_id: int, body: ChecklistItemUpdate, session: SessionDep) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    metadata = json.loads(job.job_metadata or "{}")
    items: list[dict] = metadata.get("checklist_items", [])
    if body.index < 0 or body.index >= len(items):
        raise HTTPException(status_code=400, detail="Invalid checklist index")
    items[body.index]["done"] = body.done
    metadata["checklist_items"] = items
    job.job_metadata = json.dumps(metadata)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


async def _tail_log(log_path: Path, job_id: int, session):
    # Wait for log file to appear (job may have just started)
    for _ in range(25):
        if log_path.exists():
            break
        await asyncio.sleep(0.2)

    if not log_path.exists():
        return

    async with aiofiles.open(log_path) as f:
        while True:
            line = await f.readline()
            if line:
                yield line
            else:
                job = session.get(Job, job_id)
                if job and job.status in TERMINAL_STATUSES:
                    remaining = await f.read()
                    if remaining:
                        for ln in remaining.splitlines(keepends=True):
                            yield ln
                    break
                await asyncio.sleep(0.2)
