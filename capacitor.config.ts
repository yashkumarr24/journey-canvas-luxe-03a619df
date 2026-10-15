import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Fly n Feel Android/iOS shell.
 *
 * The app loads the live, server-rendered site from the canonical domain, so
 * pages, server functions, login and enquiries run exactly as on the website.
 * `mobile/www` is only the bundled fallback shown when the site can't load.
 *
 * appId must match the Play Console / App Store Connect app and the
 * assetlinks.json / apple-app-site-association files. Change it before the
 * first store upload if you want a different one; it can't change afterwards.
 */
const config: CapacitorConfig = {
  appId: "com.flynfeelholiday.app",
  appName: "Fly n Feel",
  webDir: "mobile/www",
  server: {
    url: "https://www.flynfeelholiday.com",
    // Only our own site may load inside the app; everything else (including
    // Google sign-in) opens in the system browser.
    allowNavigation: ["www.flynfeelholiday.com", "flynfeelholiday.com"],
    // Bundled page shown when the site can't be reached (offline, DNS, 5xx).
    errorPath: "index.html",
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false, // hidden by the site once it has rendered
      backgroundColor: "#F8F8F6",
      showSpinner: false,
      androidScaleType: "CENTER_INSIDE",
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#F8F8F6",
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
