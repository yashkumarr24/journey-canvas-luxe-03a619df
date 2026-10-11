/**
 * Rule under test: a missing or failing public Supabase setup must degrade to
 * "no bearer token" — never throw and never break a server-function call.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveBearerToken } from "./bearer-token";

function clientWith(session: { access_token?: string } | null, mode: "ok" | "throws" = "ok") {
  return {
    auth: {
      getSession:
        mode === "throws"
          ? async () => {
              throw new Error("Missing Supabase environment variable(s)");
            }
          : async () => ({ data: { session } }),
    },
  };
}

describe("resolveBearerToken", () => {
  it("returns null when the app's Supabase client is unconfigured (null)", async () => {
    assert.equal(await resolveBearerToken(null), null);
  });

  it("returns the signed-in session's access token", async () => {
    const token = await resolveBearerToken(clientWith({ access_token: "jwt-token" }));
    assert.equal(token, "jwt-token");
  });

  it("returns null when there is no active session", async () => {
    assert.equal(await resolveBearerToken(clientWith(null)), null);
  });

  it("returns null instead of throwing when getSession fails (missing public env vars)", async () => {
    assert.equal(await resolveBearerToken(clientWith(null, "throws")), null);
  });
});
