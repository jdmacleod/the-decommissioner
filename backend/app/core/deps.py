import shutil
import subprocess
from datetime import datetime
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.database import get_session
from app.models.dependency import Dependency
from app.models.enums import DependencyStatus, JobType

# Registry of known external tool dependencies
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
        status = DependencyStatus.missing

        if found:
            try:
                out = subprocess.run(
                    dep["version_cmd"],
                    capture_output=True, text=True, timeout=5,
                )
                version = (out.stdout or out.stderr).strip().split("\n")[0]
                status = DependencyStatus.found
            except Exception:
                status = DependencyStatus.found

        stmt = (
            sqlite_insert(Dependency)
            .values(
                name=binary,
                required_for=str([jt.value for jt in dep["required_for"]]),
                status=status,
                version=version,
                install_hint=dep["install_hint"],
                checked_at=datetime.utcnow(),
            )
            .on_conflict_do_update(
                index_elements=["name"],
                set_={
                    "status": status,
                    "version": version,
                    "checked_at": datetime.utcnow(),
                },
            )
        )
        session.exec(stmt)
        results.append(
            Dependency(
                name=binary,
                required_for=str([jt.value for jt in dep["required_for"]]),
                status=status,
                version=version,
                install_hint=dep["install_hint"],
            )
        )

    session.commit()
    return results


# FastAPI dependency helpers

def get_db_session():
    with get_session() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db_session)]


# Runner singleton is attached to app.state; retrieved via request.app.state.runner
def get_runner(request):
    return request.app.state.runner
