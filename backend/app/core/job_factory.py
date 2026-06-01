from datetime import datetime

from sqlmodel import Session

from app.core.config import settings
from app.models.job import Job
from app.models.enums import JobStatus, JobType


def create_job(session: Session, device_id: int, job_type: JobType) -> Job:
    log_dir = settings.logs_dir
    log_dir.mkdir(parents=True, exist_ok=True)

    job = Job(
        device_id=device_id,
        job_type=job_type,
        status=JobStatus.pending,
        log_path="",
        created_at=datetime.utcnow(),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    job.log_path = str(log_dir / f"job_{job.id}.log")
    session.add(job)
    session.commit()
    session.refresh(job)

    return job
