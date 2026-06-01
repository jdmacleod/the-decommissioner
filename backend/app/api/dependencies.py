from fastapi import APIRouter
from sqlmodel import select

from app.core.deps import SessionDep, check_dependencies
from app.models.dependency import Dependency

router = APIRouter(prefix="/dependencies", tags=["dependencies"])


@router.get("", response_model=list[Dependency])
def list_dependencies(session: SessionDep):
    return session.exec(select(Dependency)).all()


@router.post("/recheck", response_model=list[Dependency])
def recheck_dependencies(session: SessionDep):
    return check_dependencies(session)
