import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { classifyLink, deepLinkPath, isRootPath } from "./link-policy";

describe("app link policy", () => {
  it("keeps our own site inside the app", () => {
    assert.equal(classifyLink("https://www.flynfeelholiday.com/holidays"), "in-app");
    assert.equal(classifyLink("/flights"), "in-app");
  });

  it("opens other sites, including Google, in the system browser", () => {
    assert.equal(classifyLink("https://accounts.google.com/o/oauth2/auth"), "system-browser");
    assert.equal(classifyLink("https://maps.google.com/?q=goa"), "system-browser");
    assert.equal(classifyLink("http://www.flynfeelholiday.com/"), "system-browser");
  });

  it("hands phone and email links to the phone", () => {
    assert.equal(classifyLink("tel:+911234567890"), "os-handler");
    assert.equal(classifyLink("mailto:a@b.co"), "os-handler");
  });

  it("ignores script links", () => {
    assert.equal(classifyLink("javascript:alert(1)"), "ignore");
  });

  it("opens only our own https links from App/Universal Links", () => {
    assert.equal(deepLinkPath("https://www.flynfeelholiday.com/auth/reset-password?code=x"), 
      "/auth/reset-password?code=x",
    );
    assert.equal(deepLinkPath("https://flynfeelholiday.com/auth/login#access_token=t"), 
      "/auth/login#access_token=t",
    );
    assert.equal(deepLinkPath("https://evil.example/auth/login"), null);
    assert.equal(deepLinkPath("http://www.flynfeelholiday.com/"), null);
  });

  it("leaves the app from the home page on back", () => {
    assert.equal(isRootPath("/"), true);
    assert.equal(isRootPath("/holidays"), false);
  });
});
