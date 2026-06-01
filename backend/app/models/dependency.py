from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.enums import DependencyStatus


class Dependency(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("name", name="uq_dependency_name"),)

    id: int | None = Field(default=None, primary_key=True)
    name: str
    required_for: str
    status: DependencyStatus
    version: str | None = None
    install_hint: str
    checked_at: datetime = Field(default_factory=datetime.utcnow)
