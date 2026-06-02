import io
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from fpdf import FPDF
from sqlmodel import select

from app.core.deps import SessionDep
from app.models.device import Device
from app.models.job import Job
from app.models.snapshot import Snapshot

router = APIRouter(prefix="/devices", tags=["certificates"])


@router.get("/{device_id}/certificate")
def get_certificate(device_id: int, session: SessionDep) -> StreamingResponse:
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    jobs = list(session.exec(select(Job).where(Job.device_id == device_id)).all())
    snapshot = session.exec(
        select(Snapshot).where(Snapshot.device_id == device_id).order_by(Snapshot.taken_at.desc())  # type: ignore[attr-defined]
    ).first()

    pdf_bytes = _generate_pdf(device, jobs, snapshot)

    filename = f"decommission-{device_id}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _generate_pdf(
    device: Device,
    jobs: list[Job],
    snapshot: Snapshot | None,
) -> bytes:
    pdf = FPDF()
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Decommission Certificate", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(
        0,
        5,
        f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    def section(title: str) -> None:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")

    def row(label: str, value: str) -> None:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(55, 6, f"{label}:", new_x="RIGHT", new_y="LAST")
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, value or "N/A", new_x="LMARGIN", new_y="NEXT")

    section("Device")
    row("Name", device.name)
    row("Type", device.device_type.value.replace("_", " ").title())
    row("Serial Number", device.serial_number or "")
    row("Stage", device.stage.value)
    row("Registered", _fmt_dt(device.created_at))

    if jobs:
        pdf.ln(4)
        section("Job History")
        for job in sorted(jobs, key=lambda j: j.created_at):
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(55, 5, f"{job.job_type.value.title()}:", new_x="RIGHT", new_y="LAST")
            pdf.set_font("Helvetica", "", 9)
            completed = _fmt_dt(job.completed_at) if job.completed_at else ""
            pdf.cell(0, 5, f"{job.status.value}  {completed}", new_x="LMARGIN", new_y="NEXT")

            if job.job_metadata:
                try:
                    meta = json.loads(job.job_metadata)
                    method = meta.get("method", "")
                    if method:
                        pdf.set_font("Helvetica", "", 8)
                        pdf.set_x(65)
                        pdf.cell(0, 4, f"Method: {method}", new_x="LMARGIN", new_y="NEXT")
                except (json.JSONDecodeError, KeyError):
                    pass

    if snapshot:
        pdf.ln(4)
        section("Snapshot")
        row("Snapshot ID", snapshot.restic_snapshot_id)
        row("Files", str(snapshot.file_count))
        row("Total Size", f"{snapshot.total_bytes / 1e9:.2f} GB")
        row("Added (net)", f"{snapshot.added_bytes / 1e9:.2f} GB")
        row("Taken At", _fmt_dt(snapshot.taken_at))
        row("Verified At", _fmt_dt(snapshot.verified_at) if snapshot.verified_at else "")

    return bytes(pdf.output())


def _fmt_dt(dt: datetime | str | None) -> str:
    if not dt:
        return "N/A"
    if isinstance(dt, str):
        return dt[:19].replace("T", " ")
    return dt.strftime("%Y-%m-%d %H:%M")
