import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isNavigationNetworkError } from "./offline-navigation";

describe("mobile navigation failures", () => {
  it("recognizes route fetch and dynamic import failures", () => {
    assert.equal(isNavigationNetworkError(new TypeError("Failed to fetch")), true);
    assert.equal(isNavigationNetworkError(new Error("Failed to fetch dynamically imported module: /assets/holidays.js")), true);
    assert.equal(isNavigationNetworkError(new Error("NetworkError when attempting to fetch resource.")), true);
  });
  it("does not classify business, auth, abort or rendering errors as disconnected navigation", () => {
    for (const text of ["Unauthorized", "Hotel not available", "Cannot read properties of undefined", "AbortError: request aborted", "404 Not Found"]) {
      assert.equal(isNavigationNetworkError(new Error(text)), false);
    }
  });
});

function shell(platform = "android", online = false) {
  const events = new Map<string, (event: any) => void>();
  let fallback = 0;
  let browser = 0;
  const plugin = { addListener: async () => ({}), getStatus: async () => ({ connected: online }), hide: async () => {}, setStyle: async () => {}, setBackgroundColor: async () => {}, open: async () => { browser++; } };
  const source = readFileSync(new URL("./native-shell.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(code, {
    exports, URL, navigator: { onLine: online },
    window: { location: { href: "https://www.flynfeelholiday.com/", pathname: "/" }, open: () => {}, addEventListener: (name: string, handler: (event: any) => void) => events.set(name, handler) },
    document: { documentElement: { classList: { add: () => {} } }, body: { appendChild: () => {} }, createElement: () => ({ setAttribute: () => {}, querySelector: () => ({ addEventListener: () => {} }) }), addEventListener: (name: string, handler: (event: any) => void) => events.set(name, handler) },
    require: (name: string) => {
      if (name === "./offline-navigation") return { isNavigationNetworkError, showNativeOffline: async () => { fallback++; } };
      if (name === "./link-policy") return { classifyLink: (href: string) => new URL(href).host === "www.flynfeelholiday.com" ? "in-app" : "system-browser" };
      return { App: plugin, Browser: plugin, Network: plugin, Keyboard: plugin, SplashScreen: plugin, StatusBar: plugin, Style: { Light: "LIGHT" }, Capacitor: { isNativePlatform: () => true, getPlatform: () => platform } };
    },
  });
  return {
    start: () => exports.startNativeShell(() => {}),
    click: (href: string) => {
      let prevented = false;
      events.get("click")?.({ button: 0, defaultPrevented: false, target: { closest: () => ({ href }) }, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => {} });
      return prevented;
    },
    reject: (reason: unknown) => events.get("unhandledrejection")?.({ reason }),
    counts: () => ({ fallback, browser }),
  };
}

describe("native click and chunk handling (simulated bridge)", () => {
  it("offline Holidays opens native fallback without navigation or retries", async () => {
    const app = shell(); await app.start();
    assert.equal(app.counts().fallback, 0);
    assert.equal(app.click("https://www.flynfeelholiday.com/holidays"), true);
    assert.equal(app.counts().fallback, 1);
  });
  it("online navigation and same-page anchors remain untouched", async () => {
    const app = shell("android", true); await app.start();
    assert.equal(app.click("https://www.flynfeelholiday.com/holidays"), false);
    const offline = shell(); await offline.start();
    assert.equal(offline.click("https://www.flynfeelholiday.com/#destinations"), false);
    assert.equal(offline.counts().fallback, 0);
  });
  it("external Google links still open in the browser", async () => {
    const app = shell(); await app.start();
    assert.equal(app.click("https://accounts.google.com/"), true);
    assert.equal(app.counts().browser, 1);
    assert.equal(app.counts().fallback, 0);
  });
  it("only failed module imports trigger the unhandled-rejection fallback", async () => {
    const app = shell(); await app.start();
    app.reject(new Error("Failed to fetch"));
    assert.equal(app.counts().fallback, 0);
    app.reject(new Error("Failed to fetch dynamically imported module: /assets/holidays.js"));
    assert.equal(app.counts().fallback, 1);
  });
});