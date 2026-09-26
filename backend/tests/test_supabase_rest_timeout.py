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

    # Default value: instantiate without the env var set.
    s = Settings(_env_file=None, SUPABASE_REST_TIMEOUT=None)  # type: ignore[call-arg]
    assert s.supabase_rest_timeout == 60.0
