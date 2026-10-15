import { describe, expect, it } from "vitest";

import { classifyLink, deepLinkPath, isRootPath } from "./link-policy";

describe("app link policy", () => {
  it("keeps our own site inside the app", () => {
    expect(classifyLink("https://www.flynfeelholiday.com/holidays")).toBe("in-app");
    expect(classifyLink("/flights")).toBe("in-app");
  });

  it("opens other sites, including Google, in the system browser", () => {
    expect(classifyLink("https://accounts.google.com/o/oauth2/auth")).toBe("system-browser");
    expect(classifyLink("https://maps.google.com/?q=goa")).toBe("system-browser");
    expect(classifyLink("http://www.flynfeelholiday.com/")).toBe("system-browser");
  });

  it("hands phone and email links to the phone", () => {
    expect(classifyLink("tel:+911234567890")).toBe("os-handler");
    expect(classifyLink("mailto:a@b.co")).toBe("os-handler");
  });

  it("ignores script links", () => {
    expect(classifyLink("javascript:alert(1)")).toBe("ignore");
  });

  it("opens only our own https links from App/Universal Links", () => {
    expect(deepLinkPath("https://www.flynfeelholiday.com/auth/reset-password?code=x")).toBe(
      "/auth/reset-password?code=x",
    );
    expect(deepLinkPath("https://flynfeelholiday.com/auth/login#access_token=t")).toBe(
      "/auth/login#access_token=t",
    );
    expect(deepLinkPath("https://evil.example/auth/login")).toBeNull();
    expect(deepLinkPath("http://www.flynfeelholiday.com/")).toBeNull();
  });

  it("leaves the app from the home page on back", () => {
    expect(isRootPath("/")).toBe(true);
    expect(isRootPath("/holidays")).toBe(false);
  });
});
