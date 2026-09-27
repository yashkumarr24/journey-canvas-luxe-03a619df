"""Verify the Supabase REST timeout is driven by configuration."""

import asyncio
import inspect

import pytest


def _make_settings(timeout: float):
    """Build a minimal stand-in for app.core.config.Settings."""

    class _S:
        supabase_url = "https://example.supabase.co"
        supabase_service_role_key = "svc-role-key"
        supabase_rest_timeout = timeout

    return _S()


def test_uses_configured_timeout():
    from app.repositories.supabase_rest import SupabaseRest

    rest = SupabaseRest(_make_settings(120.0))
    assert rest._timeout == 120.0


def test_default_timeout_when_unset():
    """When the setting is absent/zero the legacy default is used."""
    from app.repositories.supabase_rest import SupabaseRest

    rest = SupabaseRest(_make_settings(0.0))
    assert rest._timeout == 8.0  # DEFAULT_TIMEOUT


def test_send_passes_configured_timeout_to_client(monkeypatch):
    """The httpx.AsyncClient is built with the configured timeout value."""
    from app.repositories import supabase_rest as mod

    captured: dict = {}

    class _FakeResponse:
        status_code = 200

        def json(self):
            return []

    class _FakeClient:
        def __init__(self, *, timeout=None, **kw):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, *a, **kw):
            return _FakeResponse()

    monkeypatch.setattr(mod.httpx, "AsyncClient", _FakeClient)

    rest = mod.SupabaseRest(_make_settings(45.0))
    asyncio.run(rest.select("profiles", filters={"id": "eq.1"}))

    assert captured["timeout"] == 45.0


def test_send_falls_back_when_setting_missing(monkeypatch):
    """An older Settings object without the field still works."""
    from app.repositories import supabase_rest as mod

    captured: dict = {}

    class _OldSettings:
        supabase_url = "https://example.supabase.co"
        supabase_service_role_key = "svc-role-key"
        # no supabase_rest_timeout attribute

    class _FakeResponse:
        status_code = 200

        def json(self):
            return []

    class _FakeClient:
        def __init__(self, *, timeout=None, **kw):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, *a, **kw):
            return _FakeResponse()

    monkeypatch.setattr(mod.httpx, "AsyncClient", _FakeClient)
    rest = mod.SupabaseRest(_OldSettings())
    asyncio.run(rest.select("profiles", filters={"id": "eq.1"}))

    assert captured["timeout"] == 8.0  # DEFAULT_TIMEOUT


def test_settings_has_supabase_rest_timeout_field():
    """The Settings model exposes the new field with the documented default."""
    from app.core.config import Settings

    src = inspect.getsource(Settings)
    assert "supabase_rest_timeout" in src
    assert "SUPABASE_REST_TIMEOUT" in src

    # Default value: instantiate without the env var set so the documented
    # default applies (do not pass None to a float field — that raises
    # Pydantic ValidationError).
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.supabase_rest_timeout == 60.0


def test_error_body_logged_truncated_and_redacted(monkeypatch, caplog):
    """On a >=300 response, the body is logged truncated to 2000 chars and
    sensitive fields are redacted; the caller still gets the same exception."""
    import logging

    from app.repositories import supabase_rest as mod

    secret_value = "super-secret-key-value"
    long_body = ("x" * 5000)  # well over 2000 chars
    # A JSON body that echoes a sensitive field — must be redacted.
    json_body = '{"hint": "some hint", "passport": "' + secret_value + '"}'

    class _FakeResponse:
        def __init__(self, text):
            self.status_code = 503
            self.text = text

        def json(self):
            raise ValueError("not json in error path")

    class _FakeClient:
        def __init__(self, *, timeout=None, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, *a, **kw):
            return _FakeResponse(json_body)

    monkeypatch.setattr(mod.httpx, "AsyncClient", _FakeClient)

    rest = mod.SupabaseRest(_make_settings(60.0))

    with caplog.at_level(logging.WARNING, logger="app.repositories.supabase_rest"):
        with pytest.raises(mod.SupabaseUnavailableError):
            asyncio.run(rest.rpc("hotel_catalogue_save_content_batch", args={"p": 1}))

    assert any("supabase_error" in r.message for r in caplog.records)
    rec = next(r for r in caplog.records if "supabase_error" in r.message)
    extra = rec.extra_fields if hasattr(rec, "extra_fields") else {}
    # Status and table/method are logged.
    assert extra.get("status") == 503
    assert extra.get("table") == "rpc/hotel_catalogue_save_content_batch"
    assert extra.get("method") == "POST"
    # Sensitive field redacted.
    body = extra.get("body", "")
    assert secret_value not in body
    assert "passport" in body  # key retained, value redacted
    # Body is JSON-serializable & truncated to <= 2000 chars.
    assert len(body) <= 2000


def test_error_body_truncated_when_very_long(monkeypatch, caplog):
    """A very long non-JSON body is truncated to 2000 characters."""
    import logging

    from app.repositories import supabase_rest as mod

    long_body = "B" * 6000

    class _FakeResponse:
        status_code = 500
        text = long_body

        def json(self):
            raise ValueError("nope")

    class _FakeClient:
        def __init__(self, *, timeout=None, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, *a, **kw):
            return _FakeResponse()

    monkeypatch.setattr(mod.httpx, "AsyncClient", _FakeClient)
    rest = mod.SupabaseRest(_make_settings(60.0))

    with caplog.at_level(logging.WARNING, logger="app.repositories.supabase_rest"):
        with pytest.raises(mod.SupabaseUnavailableError):
            asyncio.run(rest.select("hotels", filters={"id": "eq.1"}))

    rec = next(r for r in caplog.records if "supabase_error" in r.message)
    extra = rec.extra_fields if hasattr(rec, "extra_fields") else {}
    body = extra.get("body", "")
    assert len(body) <= 2000
    assert body == "B" * 2000
