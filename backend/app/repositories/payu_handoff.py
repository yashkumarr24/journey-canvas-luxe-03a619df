"""Service-only capability storage; no in-memory fallback, no credential logging."""
import httpx


class HandoffRepo:
    def __init__(self, settings):
        self._settings = settings

    async def _post(self, path, payload, representation=False):
        settings = self._settings
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Handoff storage unavailable")
        # Do not use the shared helper's error-body logging: constraint errors
        # may echo token digests. Never retain/log response bodies on failure.
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(settings.supabase_url.rstrip("/") + "/rest/v1/" + path,
                json=payload, headers={"apikey": settings.supabase_service_role_key,
                "Authorization": "Bearer " + settings.supabase_service_role_key,
                "Prefer": "return=representation" if representation else "return=minimal"})
        if not response.is_success:
            raise RuntimeError("Handoff storage unavailable")
        return response.json() if representation else None

    async def insert(self, values):
        try:
            # Unique payment_id disallows issuing a replacement token.
            # returning=False prevents a successful response from carrying hashes.
            await self._post("payu_handoffs", values)
            return True
        except Exception:
            return False

    async def consume(self, digest):
        rows = await self._post("rpc/payu_consume_handoff", {"p_token_hash": digest}, True)
        return rows[0] if rows else None