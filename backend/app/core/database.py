from contextlib import contextmanager
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings


def get_engine():
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    return create_engine(
        settings.db_url,
        connect_args={"check_same_thread": False},
        echo=False,
    )


engine = get_engine()


@contextmanager
def get_session():
    with Session(engine) as session:
        yield session


def create_tables():
    SQLModel.metadata.create_all(engine)
