"""Centralised, environment-driven configuration.

No secret is ever hardcoded here. Every value comes from the process
environment (loaded from a local .env file in development only).
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split_csv(raw: str) -> List[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- application -----------------------------------------------------
    app_env: str = Field(default="development", alias="APP_ENV")
    app_debug: bool = Field(default=False, alias="APP_DEBUG")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    app_name: str = "Fly n Feel Booking API"
    app_version: str = "0.1.0"

    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # ---- frontend / CORS -------------------------------------------------
    frontend_url: str = Field(default="http://localhost:8080", alias="FRONTEND_URL")
    cors_allowed_origins_raw: str = Field(default="", alias="CORS_ALLOWED_ORIGINS")
    cors_allowed_origin_regex: str = Field(
        # Lovable preview + Vercel preview deployments use generated subdomains.
        default=r"^https://([a-z0-9-]+\.)*(lovable\.app|lovableproject\.com|vercel\.app)$",
        alias="CORS_ALLOWED_ORIGIN_REGEX",
    )

    # ---- Supabase (placeholders in this phase; one project per environment) --
    # The service-role key is BACKEND ONLY and must never reach the browser.
    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_anon_key: str = Field(default="", alias="SUPABASE_ANON_KEY")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_db_url: str = Field(default="", alias="SUPABASE_DB_URL")

    # ---- TripJack (BACKEND ONLY — never exposed to the browser) ------------
    # Staging/UAT: https://apitest.tripjack.com  (production uses its own host
    # AND its own key; the two are never mixed).
    tripjack_base_url: str = Field(default="", alias="TRIPJACK_BASE_URL")
    tripjack_api_key: str = Field(default="", alias="TRIPJACK_API_KEY")
    tripjack_connect_timeout: float = Field(default=5.0, alias="TRIPJACK_CONNECT_TIMEOUT")
    tripjack_read_timeout: float = Field(default=40.0, alias="TRIPJACK_READ_TIMEOUT")
    tripjack_write_timeout: float = Field(default=10.0, alias="TRIPJACK_WRITE_TIMEOUT")
    tripjack_pool_timeout: float = Field(default=5.0, alias="TRIPJACK_POOL_TIMEOUT")
    tripjack_max_connections: int = Field(default=20, alias="TRIPJACK_MAX_CONNECTIONS")
    # Search is idempotent, so a tiny retry budget is safe. Booking calls will
    # always use 0.
    tripjack_search_retries: int = Field(default=1, alias="TRIPJACK_SEARCH_RETRIES")

    # Only enable behind a trusted reverse proxy; otherwise clients could spoof
    # X-Forwarded-For and bypass rate limiting.
    trust_proxy_headers: bool = Field(default=False, alias="TRUST_PROXY_HEADERS")

    # ---- future integrations (declared, intentionally unused) ---------------
    razorpay_key_id: str = Field(default="", alias="RAZORPAY_KEY_ID")
    razorpay_key_secret: str = Field(default="", alias="RAZORPAY_KEY_SECRET")

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def cors_allowed_origins(self) -> List[str]:
        origins = _split_csv(self.cors_allowed_origins_raw)
        if self.frontend_url:
            origins.append(self.frontend_url.rstrip("/"))
        if not self.is_production:
            origins.extend(
                [
                    "http://localhost:8080",
                    "http://localhost:5173",
                    "http://127.0.0.1:8080",
                    "http://127.0.0.1:5173",
                ]
            )
        # de-duplicate, preserve order, never allow "*"
        seen: set[str] = set()
        result: List[str] = []
        for origin in origins:
            origin = origin.rstrip("/")
            if origin and origin != "*" and origin not in seen:
                seen.add(origin)
                result.append(origin)
        return result


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


# Convenience for scripts that need the raw env without importing pydantic.
def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)
