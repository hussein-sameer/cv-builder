"""Runtime settings, read from environment variables (and an optional .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env loader (no extra dependency). Existing env vars win."""
    here = Path(__file__).resolve()
    for candidate in (Path.cwd() / ".env", here.parents[1] / ".env", here.parents[2] / ".env"):
        if not candidate.is_file():
            continue
        for raw in candidate.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key.strip(), value)
        break


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ProviderDefaults:
    base_url: str
    api_key: str
    model: str


@dataclass(frozen=True)
class Settings:
    cors_origins: list[str] = field(default_factory=list)
    static_dir: str = ""
    data_dir: str = ""
    database_url: str = ""
    # --- auth
    auth_enabled: bool = True
    signup_enabled: bool = True
    admin_emails: frozenset[str] = frozenset()
    session_days: int = 30
    cookie_secure: str = "auto"  # auto | true | false
    secret_key: str = ""  # encrypts users' saved AI keys; required for saving them on Postgres
    # --- AI
    ai_daily_limit: int = 30  # per user per UTC day when the *server* key is used; 0 = unlimited
    allow_private_base_urls: bool = False
    allow_custom_base_urls: bool = True
    ai_timeout: float = 120.0
    default_provider: str = "openai"
    providers: dict[str, ProviderDefaults] = field(default_factory=dict)


def load_settings() -> Settings:
    _load_dotenv()
    env = os.getenv
    data_dir = env("DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))
    auth_enabled = _bool("AUTH_ENABLED", True)
    return Settings(
        cors_origins=[o.strip() for o in env("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
        static_dir=env("STATIC_DIR", ""),
        data_dir=data_dir,
        # Northflank's Postgres addon exposes POSTGRES_URI; other hosts usually use DATABASE_URL.
        database_url=env("DATABASE_URL") or env("POSTGRES_URI") or f"sqlite:///{Path(data_dir) / 'cvs.db'}",
        auth_enabled=auth_enabled,
        signup_enabled=_bool("SIGNUP_ENABLED", True),
        admin_emails=frozenset(e.strip().lower() for e in env("ADMIN_EMAILS", "").split(",") if e.strip()),
        session_days=int(env("SESSION_DAYS", "30")),
        cookie_secure=env("COOKIE_SECURE", "auto").strip().lower(),
        secret_key=env("SECRET_KEY", "").strip(),
        ai_daily_limit=int(env("AI_DAILY_LIMIT", "30")),
        # Block AI base URLs that resolve to private/internal IPs on a public, multi-user server (SSRF).
        allow_private_base_urls=_bool("ALLOW_PRIVATE_BASE_URLS", not auth_enabled),
        allow_custom_base_urls=_bool("ALLOW_CUSTOM_BASE_URLS", True),
        ai_timeout=float(env("AI_TIMEOUT_SECONDS", "120")),
        default_provider=env("AI_DEFAULT_PROVIDER", "openai"),
        providers={
            "openai": ProviderDefaults(
                env("OPENAI_BASE_URL", "https://api.openai.com/v1"), env("OPENAI_API_KEY", ""), env("OPENAI_MODEL", "")
            ),
            "anthropic": ProviderDefaults(
                env("ANTHROPIC_BASE_URL", "https://api.anthropic.com"), env("ANTHROPIC_API_KEY", ""), env("ANTHROPIC_MODEL", "")
            ),
            "gemini": ProviderDefaults(
                env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com"), env("GEMINI_API_KEY", ""), env("GEMINI_MODEL", "")
            ),
            "ollama": ProviderDefaults(
                env("OLLAMA_BASE_URL", "http://localhost:11434"), "", env("OLLAMA_MODEL", "")
            ),
        },
    )


settings = load_settings()
