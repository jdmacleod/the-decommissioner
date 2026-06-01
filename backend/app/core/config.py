from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    data_dir: str = str(Path.home() / ".decommissioner")
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir}/db.sqlite"

    @property
    def logs_dir(self) -> Path:
        return Path(self.data_dir) / "logs"


settings = Settings()
