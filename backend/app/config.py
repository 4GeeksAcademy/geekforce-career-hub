"""Application settings, read from environment variables (Railway service variables in production)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Core
    database_url: str = "postgresql://gf:gf@localhost:5432/geekforce"
    jwt_secret: str = "change-me-in-production"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days; the Chrome extension reuses this token
    timezone: str = "America/New_York"  # week boundaries and cron times are computed in this zone
    app_url: str = "http://localhost:8000"
    cors_origins: str = "*"  # comma-separated; the extension calls the API from chrome-extension://

    # Scheduled checks
    enable_scheduler: bool = False  # run the in-process scheduler (enable on exactly ONE service replica)
    cron_secret: str = ""  # required header X-Cron-Secret for POST /api/v1/cron/{job}

    # Brevo (email)
    brevo_api_key: str = ""
    brevo_sender_email: str = "geekforce@4geeksacademy.com"
    brevo_sender_name: str = "GeekForce Career Hub"

    # Anthropic (resume builder)
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"

    # Breathcode (phase 2: 4Geeks platform login + attendance)
    breathcode_enabled: bool = False
    breathcode_api_url: str = "https://breathecode.herokuapp.com"

    # Notion (roster sync, read-only)
    notion_token: str = ""
    notion_students_source_id: str = "f6fd23c5-65be-4d01-814c-981ae43174ea"  # Miami Student Tracker | Part-Time

    # Misc
    seed_demo: bool = False  # create demo users/data on startup if the database is empty
    static_dir: str = ""  # folder with the built frontend; served at /

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg2://" + url[len(prefix):]
        return url


settings = Settings()
