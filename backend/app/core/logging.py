"""Structured JSON logging with request-ID correlation.

Sensitive keys are redacted defensively before anything reaches a log sink.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from typing import Any

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

SENSITIVE_TOKENS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
    "service_role",
    "tripjack",
    "razorpay",
    "card",
    "cvv",
    "pan",
    "passport",
)

REDACTED = "***redacted***"


def redact(value: Any) -> Any:
    """Recursively redact values whose key looks sensitive."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if any(tok in str(k).lower() for tok in SENSITIVE_TOKENS):
                out[k] = REDACTED
            else:
                out[k] = redact(v)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": request_id_ctx.get(),
            "message": record.getMessage(),
        }
        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            payload.update(redact(extra))
        if record.exc_info:
            # Stack traces stay in server logs only, never in HTTP responses.
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.propagate = False


def get_logger(name: str) -> logging.LoggerAdapter:
    return logging.LoggerAdapter(logging.getLogger(name), {})


def log_extra(**fields: Any) -> dict[str, Any]:
    """Helper: logger.info("msg", extra=log_extra(path="/x"))."""
    return {"extra_fields": redact(fields)}
