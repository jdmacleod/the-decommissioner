import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path

from app.core.config import settings
from app.models.enums import JobStatus
from app.models.job import Job

logger = logging.getLogger(__name__)


class SubprocessRunner:
    """
    Runs an external command, streams output to a log file and to callers
    via an async generator. Updates the Job row in the DB at each lifecycle point.
    """

    def __init__(self, session_factory):
        self._session_factory = session_factory
        self._cancel_flags: dict[int, asyncio.Event] = {}

    def log_path_for(self, job_id: int) -> Path:
        log_dir = settings.logs_dir
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / f"job_{job_id}.log"

    async def run(
        self,
        job_id: int,
        cmd: list[str],
        env: dict[str, str] | None = None,
        cwd: str | None = None,
    ) -> AsyncIterator[str]:
        log_path = self.log_path_for(job_id)
        merged_env = {**os.environ, **(env or {})}
        cancel_event = asyncio.Event()
        self._cancel_flags[job_id] = cancel_event

        await self._set_status(job_id, JobStatus.in_progress)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=merged_env,
                cwd=cwd,
            )

            with open(log_path, "a", buffering=1) as log_file:
                header = f"[{datetime.utcnow().isoformat()}] START: {' '.join(cmd)}\n"
                log_file.write(header)
                yield header

                assert proc.stdout is not None
                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="replace")
                    log_file.write(line)
                    yield line

                    if cancel_event.is_set():
                        proc.terminate()
                        await self._set_status(job_id, JobStatus.cancelled)
                        self._cancel_flags.pop(job_id, None)
                        return

                await proc.wait()

                footer = f"[{datetime.utcnow().isoformat()}] EXIT: {proc.returncode}\n"
                log_file.write(footer)
                yield footer

            if cancel_event.is_set():
                await self._set_status(job_id, JobStatus.cancelled)
            elif proc.returncode == 0:
                await self._set_status(job_id, JobStatus.completed, exit_code=0)
            else:
                await self._set_status(
                    job_id,
                    JobStatus.failed,
                    exit_code=proc.returncode,
                    error_message=f"Process exited with code {proc.returncode}",
                )

        except FileNotFoundError as e:
            error = f"Command not found: {cmd[0]} — {e}\n"
            with open(log_path, "a") as log_file:
                log_file.write(error)
            yield error
            await self._set_status(job_id, JobStatus.failed, error_message=str(e))

        except Exception as e:
            error = f"Runner error: {e}\n"
            with open(log_path, "a") as log_file:
                log_file.write(error)
            yield error
            await self._set_status(job_id, JobStatus.failed, error_message=str(e))

        finally:
            self._cancel_flags.pop(job_id, None)

    async def emit_progress(self, job_id: int, data: dict) -> None:
        log_path = self.log_path_for(job_id)
        try:
            with open(log_path, "a") as f:
                f.write(f"PROGRESS:{json.dumps(data)}\n")
        except OSError as e:
            logger.warning("emit_progress failed for job %d: %s", job_id, e)

    async def replay(self, job_id: int) -> AsyncIterator[str]:
        log_path = self.log_path_for(job_id)
        if not log_path.exists():
            yield f"[no log found for job {job_id}]\n"
            return
        with open(log_path) as f:
            for line in f:
                yield line

    async def cancel(self, job_id: int) -> None:
        event = self._cancel_flags.get(job_id)
        if event:
            event.set()

    async def _set_status(
        self,
        job_id: int,
        status: JobStatus,
        exit_code: int | None = None,
        error_message: str | None = None,
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
