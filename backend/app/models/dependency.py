from typing import Optional
from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field

from app.models.enums import DependencyStatus


class Dependency(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("name", name="uq_dependency_name"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    required_for: str
    status: DependencyStatus
    version: Optional[str] = None
    install_hint: str
    checked_at: datetime = Field(default_factory=datetime.utcnow)
