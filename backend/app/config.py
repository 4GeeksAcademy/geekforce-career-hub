"""Application settings, read from environment variables (Railway service variables in production)."""
from pydantic import AliasChoices, Field
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

    # ActiveCampaign (email channel). Accepts the names already used by Lali and the Marketing Hub.
    ac_url: str = Field("", validation_alias=AliasChoices("ACTIVECAMPAIGN_URL", "AC_API_URL", "AC_URL"))
    ac_key: str = Field("", validation_alias=AliasChoices("ACTIVECAMPAIGN_API_KEY", "AC_API_KEY", "AC_KEY"))

    # Job Radar
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    adzuna_country: str = "us"
    jobs_ingest_secret: str = ""  # header X-Jobs-Secret for POST /api/v1/integrations/jobs (grokbot)

    # Automations: every stage/status change is POSTed here (e.g. an n8n Webhook URL), header X-GeekForce-Secret
    automation_webhook_url: str = ""
    n8n_base_url: str = "https://n8n.4geeks.com"
    automation_webhook_secret: str = ""

    # Brevo (email fallback, only used when ActiveCampaign isn't configured)
    brevo_api_key: str = ""
    brevo_sender_email: str = "geekforce@4geeksacademy.com"
    brevo_sender_name: str = "GeekForce Career Hub"

    # Anthropic (resume builder)
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"

    # 4Geeks (Breathcode): the only way to sign in. Hosted login + GitHub OAuth live on this API.
    breathcode_api_url: str = "https://breathecode.herokuapp.com"
    dev_password_login: bool = False  # local development only: email + password form for the demo accounts

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

# Values that ship in the code or in .env.example: anyone who reads the repo knows them.
_KNOWN_JWT_SECRETS = {"change-me-in-production", "generate-a-long-random-string", "changeme", "secret"}
MIN_JWT_SECRET_LENGTH = 32


def jwt_secret_problem(secret: str) -> str | None:
    """Why this JWT secret is unsafe, or None if it's fine. Whoever knows the secret can sign a token for any user,
    admins included, so it must be long, random and never one of the values written in the repo."""
    if not secret or secret.strip().lower() in _KNOWN_JWT_SECRETS:
        return "JWT_SECRET is not set (or still has the example value from the repo)"
    if len(secret) < MIN_JWT_SECRET_LENGTH:
        return f"JWT_SECRET is shorter than {MIN_JWT_SECRET_LENGTH} characters"
    return None


def check_jwt_secret(s: Settings) -> None:
    """Refuse to start with an unsafe JWT secret. Only DEV_PASSWORD_LOGIN (local development) downgrades it to a
    warning, so a production deploy that forgot JWT_SECRET fails loudly instead of accepting forged tokens."""
    problem = jwt_secret_problem(s.jwt_secret)
    if not problem:
        return
    hint = 'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    if s.dev_password_login:
        import logging
        logging.getLogger("geekforce").warning("%s. Fine for local development only. %s", problem, hint)
        return
    raise RuntimeError(f"{problem}. {hint}")
