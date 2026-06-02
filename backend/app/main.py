import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.certificates import router as certificates_router
from app.api.dependencies import router as dependencies_router
from app.api.devices import router as devices_router
from app.api.duplicate_groups import router as duplicate_groups_router
from app.api.file_entries import router as file_entries_router
from app.api.jobs import router as jobs_router
from app.api.snapshots import router as snapshots_router
from app.api.storage_targets import router as storage_targets_router
from app.core.config import settings
from app.core.database import get_session
from app.core.runner import SubprocessRunner


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure data directories exist
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    settings.logs_dir.mkdir(parents=True, exist_ok=True)

    # Run alembic migrations
    backend_dir = Path(__file__).parent.parent
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_dir,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Alembic migration failed:\n{result.stderr}", file=sys.stderr)
        raise RuntimeError("Database migration failed")

    # Check external tool dependencies
    from app.core.deps import check_dependencies

    with get_session() as session:
        check_dependencies(session)

    # Create runner singleton and attach to app state
    app.state.runner = SubprocessRunner(get_session)

    yield

    # Cleanup (nothing needed currently)


app = FastAPI(
    title="the-decommissioner",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(dependencies_router, prefix="/api")
app.include_router(file_entries_router, prefix="/api")
app.include_router(duplicate_groups_router, prefix="/api")
app.include_router(storage_targets_router, prefix="/api")
app.include_router(snapshots_router, prefix="/api")
app.include_router(certificates_router, prefix="/api")

# Serve compiled frontend from backend/app/static if it exists
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


def main():
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=False,
    )


if __name__ == "__main__":
    main()
