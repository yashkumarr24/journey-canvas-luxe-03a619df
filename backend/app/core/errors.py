"""Safe, structured error responses.

Every handled failure returns:
    {"success": false, "code": "...", "message": "...", "request_id": "..."}

Stack traces, env values, credentials, filesystem paths and infrastructure
details are logged server-side and never serialised into a response.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger, log_extra, request_id_ctx

logger = get_logger(__name__)

GENERIC_MESSAGE = "Something went wrong."


class AppError(Exception):
    """Base class for expected, user-safe application errors."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "APP_ERROR"
    message: str = "Request could not be processed."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"
    message = "Resource not found."


class ValidationFailedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "VALIDATION_ERROR"
    message = "Some of the submitted values are invalid."


class UpstreamError(AppError):
    """A downstream provider (later: TripJack/Razorpay) failed."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "UPSTREAM_ERROR"
    message = "A partner service is currently unavailable. Please try again."


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "success": False,
        "code": code,
        "message": message,
        "request_id": request_id_ctx.get(),
    }
    if details is not None:
        body["details"] = details
    return body


_HTTP_CODE_MAP = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    429: "RATE_LIMITED",
}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        logger.warning(
            "app_error",
            extra=log_extra(code=exc.code, status=exc.status_code),
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Field-level info only: location + type. Never echo submitted values.
        details = [
            {"field": ".".join(str(p) for p in err.get("loc", [])[1:]), "type": err.get("type")}
            for err in exc.errors()
        ]
        logger.info("validation_error", extra=log_extra(fields=[d["field"] for d in details]))
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=error_body(
                "VALIDATION_ERROR",
                "Some of the submitted values are invalid.",
                details,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODE_MAP.get(exc.status_code, "HTTP_ERROR")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        if exc.status_code >= 500:
            code, message = "INTERNAL_ERROR", GENERIC_MESSAGE
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, message),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # Full detail to logs, nothing but a generic message to the client.
        logger.exception("unhandled_exception", extra=log_extra(kind=type(exc).__name__))
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_body("INTERNAL_ERROR", GENERIC_MESSAGE),
        )
