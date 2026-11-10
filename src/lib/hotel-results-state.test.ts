import { describe, expect, it } from "vitest";
import { shouldShowSignInPrompt, SIGNIN_PROMPT_COOLDOWN_MS } from "./hotel-results-state";

describe("sign-in prompt pacing", () => {
  const now = 1_800_000_000_000;
  it("shows when never shown or dismissed", () => expect(shouldShowSignInPrompt(now, false, null)).toBe(true));
  it("shows at most once per session", () => expect(shouldShowSignInPrompt(now, true, null)).toBe(false));
  it("stays hidden within 24 hours of dismissal", () =>
    expect(shouldShowSignInPrompt(now, false, now - SIGNIN_PROMPT_COOLDOWN_MS + 1000)).toBe(false));
  it("may show again after 24 hours", () =>
    expect(shouldShowSignInPrompt(now, false, now - SIGNIN_PROMPT_COOLDOWN_MS - 1)).toBe(true));
});
