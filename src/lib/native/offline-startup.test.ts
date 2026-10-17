import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import config from "../../../capacitor.config";

const html = readFileSync(new URL("../../../mobile/www/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Offline page script missing");

function offlinePage(capacitor?: unknown) {
  let click: (() => void) | undefined;
  const navigations: string[] = [];
  const timers: { callback: () => void; delay: number }[] = [];
  const button = {
    disabled: false,
    textContent: "Try again",
    addEventListener: (_event: string, handler: () => void) => { click = handler; },
  };
  runInNewContext(script as string, {
    window: { Capacitor: capacitor, location: { replace: (url: string) => navigations.push(url) } },
    document: { getElementById: () => button },
    setTimeout: (callback: () => void, delay: number) => timers.push({ callback, delay }),
    Promise,
  });
  return { button, navigations, timers, retry: () => click?.() };
}

describe("offline startup", () => {
  it("dismisses the launch splash natively after three seconds without hosted JavaScript", () => {
    assert.equal(config.plugins?.SplashScreen.launchAutoHide, true);
    assert.equal(config.plugins?.SplashScreen.launchShowDuration, 3000);
  });

  it("keeps the offline fallback bundled and the canonical website unchanged", () => {
    assert.equal(config.webDir, "mobile/www");
    assert.equal(config.server?.errorPath, "index.html");
    assert.equal(config.server?.url, "https://www.flynfeelholiday.com");
  });

  it("makes no automatic request or retry timer when opened without a plugin bridge", () => {
    const page = offlinePage();
    assert.deepEqual(page.navigations, []);
    assert.deepEqual(page.timers, []);
    assert.equal(page.button.disabled, false);
  });

  it("manual Retry loads the canonical site once, then permits a later manual attempt", () => {
    const page = offlinePage();
    page.retry();
    page.retry();
    assert.deepEqual(page.navigations, ["https://www.flynfeelholiday.com/"]);
    assert.equal(page.button.disabled, true);
    assert.equal(page.timers.length, 1);
    assert.equal(page.timers[0]?.delay, 8000);
    page.timers[0]?.callback();
    assert.equal(page.button.disabled, false);
    assert.equal(page.navigations.length, 1);
    page.retry();
    assert.equal(page.navigations.length, 2);
  });

  it("tolerates missing plugins and synchronous splash-hide failures", () => {
    assert.equal(offlinePage({}).button.disabled, false);
    assert.equal(offlinePage({ Plugins: { SplashScreen: { hide: () => { throw new Error("unavailable"); } } } }).button.disabled, false);
  });

  it("handles a rejected best-effort splash-hide without an unhandled rejection", async () => {
    let calls = 0;
    offlinePage({ Plugins: { SplashScreen: { hide: () => { calls++; return Promise.reject(new Error("unavailable")); } } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
  });
});