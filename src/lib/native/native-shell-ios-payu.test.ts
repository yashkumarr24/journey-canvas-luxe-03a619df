import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { takeIosPaymentRecovery } from "./ios-payu";

class Store {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(n: number) {
    return [...this.values.keys()][n] ?? null;
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
  clear() {
    this.values.clear();
  }
}

function shell(store: Store, ref = "FF-AB12CD34") {
  store.setItem("fnf.iosPaymentRecovery", JSON.stringify({ ref, expiresAt: Date.now() + 60_000 }));
  const listeners = new Map<string, (event?: unknown) => void>();
  const navigations: string[] = [];
  let browserOpens = 0;
  const plugin = {
    addListener: async (name: string, handler: (event?: unknown) => void) => {
      listeners.set(name, handler);
      return {};
    },
    getStatus: async () => ({ connected: true }),
    hide: async () => {},
    setStyle: async () => {},
    setBackgroundColor: async () => {},
    open: async () => {
      browserOpens++;
    },
    close: async () => {},
  };
  const source = readFileSync(new URL("./native-shell.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { startNativeShell?: (navigate: (path: string) => void) => Promise<void> } = {};
  runInNewContext(code, {
    exports,
    URL,
    navigator: { onLine: true },
    window: {
      localStorage: store,
      location: { href: "https://staging.example.test/", pathname: "/", search: "" },
      open: () => {},
      addEventListener: () => {},
    },
    document: {
      documentElement: { classList: { add: () => {} } },
      body: { appendChild: () => {} },
      createElement: () => ({
        setAttribute: () => {},
        querySelector: () => ({ addEventListener: () => {} }),
      }),
      addEventListener: () => {},
    },
    require: (name: string) => {
      if (name === "./ios-payu") return { IOS_PAYU_HANDOFF_ENABLED: true, takeIosPaymentRecovery };
      if (name === "./offline-navigation")
        return { isNavigationNetworkError: () => false, showNativeOffline: async () => {} };
      if (name === "./link-policy")
        return { classifyLink: () => "in-app", deepLinkPath: () => null, isRootPath: () => true };
      return {
        App: plugin,
        Browser: plugin,
        Network: plugin,
        Keyboard: plugin,
        SplashScreen: plugin,
        StatusBar: plugin,
        Style: { Light: "LIGHT" },
        Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
      };
    },
  });
  return {
    start: () => exports.startNativeShell?.((path) => navigations.push(path)),
    emit: (name: string, event?: unknown) => listeners.get(name)?.(event),
    hasListener: (name: string) => listeners.has(name),
    navigations,
    browserOpens: () => browserOpens,
  };
}

describe("iOS PayU recovery lifecycle (mocked native bridge)", () => {
  it("Safari dismissal opens only the existing booking status", async () => {
    const app = shell(new Store());
    await app.start();
    assert.deepEqual(app.navigations, ["/hotels/confirmation?ref=FF-AB12CD34"]); // cold start
    app.emit("browserFinished");
    assert.deepEqual(app.navigations, [
      "/hotels/confirmation?ref=FF-AB12CD34",
      "/hotels/confirmation?ref=FF-AB12CD34",
    ]);
    assert.equal(app.browserOpens(), 0);
  });

  it("repeated app resumes never register or trigger recovery redirects", async () => {
    const app = shell(new Store());
    await app.start();
    assert.equal(app.hasListener("appStateChange"), false);
    for (let i = 0; i < 5; i++) app.emit("appStateChange", { isActive: true });
    assert.deepEqual(app.navigations, ["/hotels/confirmation?ref=FF-AB12CD34"]);
    assert.equal(app.browserOpens(), 0);
  });

  it("force-close and relaunch performs one cold-start status recovery", async () => {
    const store = new Store();
    const first = shell(store);
    await first.start();
    const relaunched = shell(store);
    await relaunched.start();
    await relaunched.start();
    assert.deepEqual(first.navigations, ["/hotels/confirmation?ref=FF-AB12CD34"]);
    assert.deepEqual(relaunched.navigations, ["/hotels/confirmation?ref=FF-AB12CD34"]);
    assert.equal(relaunched.browserOpens(), 0);
  });
});
