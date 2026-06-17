from pathlib import Path

from pydantic_settings import BaseSettings

# Resolve .env search order: backend/ first, then project root.
# The Makefile runs `cd backend && uvicorn ...` so cwd is backend/.
# A plain "env_file": ".env" would miss the project-root .env entirely.
_BACKEND_ENV = Path(__file__).parent.parent.parent / ".env"  # backend/.env
_ROOT_ENV = _BACKEND_ENV.parent.parent / ".env"  # project-root .env
_ENV_FILES = [str(p) for p in (_BACKEND_ENV, _ROOT_ENV) if p.exists()]


class Settings(BaseSettings):
    data_dir: str = str(Path.home() / ".decommissioner")
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"

    model_config = {
        "env_file": _ENV_FILES or ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",  # .env also holds RESTIC_PASSWORD_* vars not managed by Settings
    }

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir}/db.sqlite"

    @property
    def logs_dir(self) -> Path:
        return Path(self.data_dir) / "logs"

    @property
    def photos_dir(self) -> Path:
        return Path(self.data_dir) / "photos"


settings = Settings()
