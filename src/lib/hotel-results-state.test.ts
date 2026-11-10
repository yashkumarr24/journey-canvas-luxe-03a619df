import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldShowSignInPrompt, SIGNIN_PROMPT_COOLDOWN_MS } from "./hotel-results-state";

describe("sign-in prompt pacing", () => {
  const now = 1_800_000_000_000;
  it("shows when never shown or dismissed", () => assert.equal(shouldShowSignInPrompt(now, false, null), true));
  it("shows at most once per session", () => assert.equal(shouldShowSignInPrompt(now, true, null), false));
  it("stays hidden within 24 hours of dismissal", () =>
    assert.equal(shouldShowSignInPrompt(now, false, now - SIGNIN_PROMPT_COOLDOWN_MS + 1000), false));
  it("may show again after 24 hours", () =>
    assert.equal(shouldShowSignInPrompt(now, false, now - SIGNIN_PROMPT_COOLDOWN_MS - 1), true));
});
