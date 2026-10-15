/**
 * Android/iOS behaviour for the hosted site. Loaded with a dynamic import from
 * the root layout ONLY when isNativeApp() is true, so none of this code (or
 * the Capacitor plugins) runs on the website.
 *
 * - Splash hidden after first render; status bar matches the site.
 * - `native-app` / `native-ios` / `native-android` classes for safe areas.
 * - Android back button: in-app history, leave the app on the home page.
 * - Keyboard: focused field scrolled into view.
 * - Offline banner with retry (the bundled page covers a failed first load).
 * - External links -> system browser; tel:/mailto: -> the phone's apps.
 * - App Links / Universal Links and the Google sign-in return open in-app.
 */
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

import { classifyLink, deepLinkPath, isRootPath } from "./link-policy";

let started = false;

export async function startNativeShell(navigate: (path: string) => void): Promise<void> {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  const root = document.documentElement;
  root.classList.add("native-app", `native-${Capacitor.getPlatform()}`);

  void SplashScreen.hide().catch(() => undefined);
  void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
  if (Capacitor.getPlatform() === "android") {
    void StatusBar.setBackgroundColor({ color: "#F8F8F6" }).catch(() => undefined);
  }

  // ---- Android back button ------------------------------------------------
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && !isRootPath(window.location.pathname)) window.history.back();
    else void App.exitApp();
  });

  // ---- App Links / Universal Links / OAuth return -------------------------
  void App.addListener("appUrlOpen", ({ url }) => {
    const path = deepLinkPath(url);
    if (!path) return;
    void Browser.close().catch(() => undefined); // Google sign-in sheet, if open
    // Auth returns carry a code/token: a full load lets the auth client
    // exchange it exactly as on the website. Other links use the router.
    if (/[?&#](code|token_hash|access_token|error)=/.test(path)) window.location.assign(path);
    else navigate(path);
  });

  // ---- Keyboard -------------------------------------------------------------
  void Keyboard.addListener("keyboardDidShow", () => {
    const el = document.activeElement as HTMLElement | null;
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }).catch(() => undefined);

  // ---- External links -------------------------------------------------------
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const action = classifyLink(a.href, window.location.href);
      if (action === "system-browser") {
        event.preventDefault();
        void Browser.open({ url: a.href });
      } else if (action === "os-handler") {
        event.preventDefault();
        window.location.href = a.href; // native shell hands tel:/mailto: to the OS
      }
    },
    true,
  );
  // window.open from scripts (e.g. maps, share links)
  const nativeOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = url ? String(url) : "";
    if (href && classifyLink(href, window.location.href) === "system-browser") {
      void Browser.open({ url: new URL(href, window.location.href).toString() });
      return null;
    }
    return nativeOpen(url, target, features);
  };

  // ---- Offline banner ---------------------------------------------------------
  const banner = document.createElement("div");
  banner.className = "native-offline";
  banner.setAttribute("role", "status");
  banner.hidden = true;
  banner.innerHTML =
    '<span>You\u2019re offline. Some pages may not load.</span><button type="button">Retry</button>';
  banner.querySelector("button")?.addEventListener("click", async () => {
    const s = await Network.getStatus();
    if (s.connected) window.location.reload();
  });
  document.body.appendChild(banner);
  const show = (connected: boolean) => {
    banner.hidden = connected;
  };
  void Network.getStatus().then((s) => show(s.connected));
  void Network.addListener("networkStatusChange", (s) => show(s.connected));
}

/** Google sign-in inside the app: Google blocks embedded web views, so the
 * consent page opens in the system browser and returns via an App Link. */
export async function openInSystemBrowser(url: string): Promise<void> {
  await Browser.open({ url, presentationStyle: "popover" });
}
