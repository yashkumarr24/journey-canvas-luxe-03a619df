import { createFileRoute } from "@tanstack/react-router";

/** Raw HTML deliberately bypasses app/analytics rendering. Fragment is stripped
 * before any POST, and never reaches server access logs or referrers. */
export const Route = createFileRoute("/api/public/payu-handoff")({
  server: {
    handlers: {
      GET: async () => {
        const nonce = crypto.randomUUID().replaceAll("-", "");
        const script = `const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
if (/^[A-Za-z0-9_-]{43}$/.test(token || '')) {
 const form = document.createElement('form'); form.method = 'POST';
 form.action = '/api/public/payu-handoff';
 const input = document.createElement('input'); input.type = 'hidden'; input.name = 'token'; input.value = token;
 form.appendChild(input); document.body.appendChild(form); form.submit();
} else { document.getElementById('status').textContent = 'Payment link unavailable. Return to the app to check your booking status.'; }`;
        return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Secure App Payment — Fly n Feel Holidays</title></head><body><p id="status">Opening secure payment…</p><script nonce="${nonce}">${script}</script></body></html>`, {
          headers: {
            "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
            "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
            "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
          },
        });
      },
      POST: async ({ request }) => {
        // New proxy only. Existing website payment proxy remains untouched.
        // No auth cookie required: single-use capability is verified by FastAPI.
        const unavailable = () => new Response("Payment link unavailable. Return to the app to check your booking status.", {
          status: 409, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
        });
        const raw = process.env['BOOKING_API_ORIGIN'];
        if (!raw || request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return unavailable();
        const body = await request.text();
        const fields = new URLSearchParams(body);
        if (body.length > 256 || fields.size !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(fields.get("token") ?? "")) return unavailable();
        try {
          const origin = new URL(raw);
          if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") return unavailable();
          const upstream = await fetch(new URL("/api/v1/payments/handoff/redeem", origin), {
            method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
            body, redirect: "manual", signal: AbortSignal.timeout(15_000),
          });
          if (!upstream.ok || !upstream.headers.get("content-type")?.startsWith("text/html")) return unavailable();
          const headers = new Headers({ "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "x-content-type-options": "nosniff" });
          for (const name of ["content-type", "content-security-policy"]) {
            const value = upstream.headers.get(name);
            if (value) headers.set(name, value);
          }
          return new Response(upstream.body, { headers });
        } catch { return unavailable(); }
      },
    },
  },
});