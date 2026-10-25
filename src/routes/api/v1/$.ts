import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin proxy: /api/v1/* on the website -> Fly n Feel FastAPI backend.
 *
 * The backend origin is read server-side from BOOKING_API_ORIGIN (never a
 * VITE_ variable), so it never ships to the browser. The proxy adds no
 * credentials of its own: it only forwards the caller's own headers, and the
 * FastAPI backend stays the security boundary (auth, rate limits, validation).
 */

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "idempotency-key",
  "x-guest-token",
  "x-request-id",
  "user-agent",
];

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "x-request-id",
  "retry-after",
  "location",
];

const MAX_BODY_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 95_000;

function backendOrigin(): URL | null {
  const raw = (process.env.BOOKING_API_ORIGIN ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production")) return null;
    return url;
  } catch {
    return null;
  }
}

function failure(status: number, code: string, message: string) {
  return Response.json({ success: false, code, message }, { status, headers: { "cache-control": "no-store" } });
}

async function proxy({ request, params }: { request: Request; params: { _splat?: string } }) {
  const origin = backendOrigin();
  if (!origin) {
    return failure(503, "BOOKING_API_NOT_CONFIGURED", "The booking service is being configured. Please check back soon.");
  }

  const splat = params._splat ?? "";
  // Reject traversal/odd paths so the proxy can only reach /api/v1/*.
  if (splat.split("/").some((s) => s === ".." || s === ".") || splat.includes("\\")) {
    return failure(400, "BAD_PATH", "Invalid request path.");
  }

  const incoming = new URL(request.url);
  const target = new URL(`/api/v1/${splat}`, origin);
  target.search = incoming.search;
  if (target.origin !== origin.origin || !target.pathname.startsWith("/api/v1/")) {
    return failure(400, "BAD_PATH", "Invalid request path.");
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp =
    request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return failure(413, "PAYLOAD_TOO_LARGE", "Request is too large.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return timedOut
      ? failure(504, "UPSTREAM_TIMEOUT", "The booking service is taking longer than expected. Please try again.")
      : failure(502, "UPSTREAM_UNAVAILABLE", "The booking service is temporarily unavailable. Please try again shortly.");
  }

  const outHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  if (!outHeaders.has("cache-control")) outHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: proxy,
      POST: proxy,
      PUT: proxy,
      PATCH: proxy,
      DELETE: proxy,
    },
  },
});
