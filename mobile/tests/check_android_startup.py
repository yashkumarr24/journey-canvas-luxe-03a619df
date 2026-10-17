"""Compile and exercise the actual MainActivity using small JVM Android fakes.

Run with JDK 21: python3 mobile/tests/check_android_startup.py
This tests controller logic, not Android/WebView rendering or device behaviour.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    "android/os/Bundle.java": "package android.os; public class Bundle {}",
    "android/os/Looper.java": "package android.os; public class Looper { public static Looper getMainLooper() { return new Looper(); } }",
    "android/os/Handler.java": """package android.os;
public class Handler {
  public static Runnable pending; public static long delay;
  public Handler(Looper looper) {}
  public void removeCallbacks(Runnable r) { if (pending == r) pending = null; }
  public boolean postDelayed(Runnable r, long ms) { pending = r; delay = ms; return true; }
  public static void fire() { Runnable r = pending; pending = null; if (r != null) r.run(); }
}""",
    "android/webkit/WebView.java": """package android.webkit;
public class WebView {
  public String url = "https://www.flynfeelholiday.com/";
  public int stops = 0; public int loads = 0;
  public int clears = 0; public com.getcapacitor.BridgeWebViewClient client;
  public String getUrl() { return url; }
  public void stopLoading() { stops++; }
  public void loadUrl(String next) { url = next; loads++; }
  public void clearHistory() { clears++; }
  public boolean post(Runnable r) { r.run(); return true; }
}""",
    "android/webkit/WebResourceRequest.java": "package android.webkit; public interface WebResourceRequest { boolean isForMainFrame(); default android.net.Uri getUrl() { return null; } }",
    "android/net/Uri.java": "package android.net; public class Uri { final String s; public Uri(String s) { this.s=s; } public String toString() { return s; } }",
    "android/graphics/Bitmap.java": "package android.graphics; public class Bitmap {}",
    "android/webkit/WebResourceError.java": "package android.webkit; public class WebResourceError {}",
    "android/webkit/WebResourceResponse.java": "package android.webkit; public class WebResourceResponse {}",
    "androidx/activity/OnBackPressedCallback.java": "package androidx.activity; public abstract class OnBackPressedCallback { public boolean enabled; public OnBackPressedCallback(boolean e) { enabled=e; } public void setEnabled(boolean e) { enabled=e; } public abstract void handleOnBackPressed(); }",
    "com/getcapacitor/BridgeWebViewClient.java": """package com.getcapacitor;
import android.webkit.*;
public class BridgeWebViewClient {
  protected BridgeActivity.Bridge bridge;
  public BridgeWebViewClient(BridgeActivity.Bridge b) { bridge=b; }
  public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {}
  public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {}
  public void onPageFinished(WebView v, String u) { bridge.listener.onPageLoaded(v); }
  public void onPageStarted(WebView v, String u, android.graphics.Bitmap f) { bridge.listener.onPageStarted(v); }
  public int passedThrough = 0;
  public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { passedThrough++; return false; }
}""",
    "com/flynfeelholiday/app/OfflineNavigation.java": "package com.flynfeelholiday.app; public class OfflineNavigation {}",
    "com/getcapacitor/WebViewListener.java": """package com.getcapacitor;
import android.webkit.WebView;
public abstract class WebViewListener {
  public void onPageStarted(WebView view) {}
  public void onPageLoaded(WebView view) {}
}""",
    "com/getcapacitor/BridgeActivity.java": """package com.getcapacitor;
import android.os.Bundle; import android.webkit.WebView;
public class BridgeActivity {
  protected Bridge bridge; protected Builder bridgeBuilder = new Builder();
  public void onCreate(Bundle state) { load(); }
  protected void load() { bridge = new Bridge(); bridge.listener=bridgeBuilder.listener; }
  public void registerPlugin(Class<?> p) {}
  public boolean finished = false;
  public void finish() { finished=true; }
  public Dispatcher dispatcher=new Dispatcher();
  public Dispatcher getOnBackPressedDispatcher() { return dispatcher; }
  public static class Dispatcher {
    public androidx.activity.OnBackPressedCallback callback;
    public void addCallback(Object owner, androidx.activity.OnBackPressedCallback c) { callback=c; }
  }
  public void onDestroy() {}
  public boolean isFinishing() { return false; }
  public Bridge getBridge() { return bridge; }
  public WebViewListener listener() { return bridgeBuilder.listener; }
  public static class Builder {
    WebViewListener listener;
    public Builder addWebViewListener(WebViewListener value) { listener = value; return this; }
  }
  public static class Bridge {
    WebViewListener listener;
    WebView view = new WebView();
    public String getErrorUrl() { return "https://localhost/index.html"; }
    public WebView getWebView() { return view; }
    public void setWebViewClient(BridgeWebViewClient c) { view.client=c; }
  }
}""",
    "StartupChecks.java": """import android.os.Handler;
import android.webkit.WebView;
import com.flynfeelholiday.app.MainActivity;
public class StartupChecks {
  static void check(boolean condition, String rule) { if (!condition) throw new AssertionError(rule); }
  static android.webkit.WebResourceRequest req(String u) {
    return new android.webkit.WebResourceRequest() { public boolean isForMainFrame() { return true; } public android.net.Uri getUrl() { return new android.net.Uri(u); } };
  }
  static void tap(WebView v) { v.client.shouldOverrideUrlLoading(v, req("fnf-offline://retry")); }
  static MainActivity start() { Handler.pending = null; MainActivity a = new MainActivity(); a.onCreate(null); return a; }
  public static void main(String[] args) {
    MainActivity a = start(); WebView v = a.getBridge().getWebView();
    check(Handler.pending != null && Handler.delay == 15000, "cold startup deadline is 15 seconds");
    Runnable original = Handler.pending;
    v.url = "https://www.flynfeelholiday.com/redirect"; v.client.onPageStarted(v, v.url, null);
    check(Handler.pending == original, "redirect does not extend startup wait");
    Handler.fire();
    check(v.stops == 1 && v.loads == 1 && v.url.equals(a.getBridge().getErrorUrl()), "stall loads local fallback once");
    Handler.fire(); check(v.loads == 1, "no automatic retry loop");
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    check(Handler.pending == null, "local fallback cancels deadline");
    v.url = "https://www.flynfeelholiday.com/"; v.client.onPageStarted(v, v.url, null);
    check(Handler.pending != null && Handler.delay == 15000, "manual offline retry gets a fresh deadline");
    a.listener().onPageLoaded(v); check(Handler.pending == null, "successful retry cancels deadline");
    v.url = "https://www.flynfeelholiday.com/auth/login?code=test"; v.client.onPageStarted(v, v.url, null);
    check(Handler.pending == null, "warm OAuth and ordinary navigation are not timed");
    a = start(); a.onDestroy(); check(Handler.pending == null, "destroy cancels pending deadline");
    a = start(); v = a.getBridge().getWebView(); v.url = a.getBridge().getErrorUrl();
    v.client.onPageStarted(v, v.url, null); check(Handler.pending == null, "immediate native load error cancels startup timeout");
    a = start(); v = a.getBridge().getWebView(); a.listener().onPageLoaded(v);
    android.webkit.WebResourceRequest image = () -> false;
    android.webkit.WebResourceRequest document = () -> true;
    v.client.onReceivedError(v, image, new android.webkit.WebResourceError());
    check(v.loads == 0, "failed image never replaces page");
    v.client.onReceivedHttpError(v, image, new android.webkit.WebResourceResponse());
    check(v.loads == 0, "HTTP image error never replaces page");
    v.url = "https://www.flynfeelholiday.com/holidays";
    v.client.onReceivedError(v, document, new android.webkit.WebResourceError());
    check(v.loads == 1 && v.url.equals(a.getBridge().getErrorUrl()), "warm main-frame failure loads branded page directly");
    v.client.onReceivedError(v, document, new android.webkit.WebResourceError());
    check(v.loads == 1, "repeated error cannot loop");
    v.client.onPageFinished(v, "https://www.flynfeelholiday.com/holidays");
    check(v.clears == 0 && a.dispatcher.callback.enabled, "failed-document finish cannot cancel fallback");
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    check(v.clears == 1, "offline completion removes raw error history");
    a.dispatcher.callback.handleOnBackPressed(); check(a.finished, "offline Back exits instead of revisiting raw error");
    a = start(); v = a.getBridge().getWebView(); a.listener().onPageLoaded(v);
    v.client.onReceivedHttpError(v, document, new android.webkit.WebResourceResponse());
    check(v.loads == 1, "main-frame HTTP failure loads branded page");
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    v.url = "https://www.flynfeelholiday.com/"; v.client.onPageStarted(v, v.url, null);
    check(Handler.delay == 15000 && !a.dispatcher.callback.enabled, "retry bounded and normal Back restored");
    a.listener().onPageLoaded(v);
    check(v.clears == 2 && Handler.pending == null, "successful recovery removes offline history without touching storage");
    a = start(); v = a.getBridge().getWebView(); a.listener().onPageLoaded(v); a.showOffline();
    check(v.loads == 1, "client navigation plugin uses same native fallback");
    // Repeated offline retries through the native retry lifecycle.
    a = start(); v = a.getBridge().getWebView(); a.listener().onPageLoaded(v);
    v.client.onReceivedError(v, document, new android.webkit.WebResourceError());
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    check(v.loads == 1 && v.url.equals(a.getBridge().getErrorUrl()), "first failure shows branded page");
    tap(v);
    check(Handler.pending != null && Handler.delay == 15000, "bridge-absent sentinel retry arms a fresh 15 second deadline");
    tap(v);
    check(v.loads == 2, "double-tap retry cannot stack loads");
    v.client.onReceivedError(v, document, new android.webkit.WebResourceError());
    check(v.loads == 3 && v.url.equals(a.getBridge().getErrorUrl()), "failed retry returns to branded page, never the raw error");
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    tap(v);
    v.client.onReceivedError(v, document, new android.webkit.WebResourceError());
    check(v.loads == 5 && v.url.equals(a.getBridge().getErrorUrl()), "second failed retry still returns to branded page");
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    tap(v);
    check(v.url.equals("https://www.flynfeelholiday.com/"), "online tap loads the canonical site");
    v.client.onPageStarted(v, v.url, null); v.client.onPageFinished(v, v.url);
    check(Handler.pending == null && !a.dispatcher.callback.enabled, "retry after reconnecting succeeds and cancels the deadline");
    // Ordinary website pages cannot trigger the offline-only mechanism.
    int loads = v.loads;
    v.url = "https://www.flynfeelholiday.com/holidays";
    check(v.client.shouldOverrideUrlLoading(v, req("fnf-offline://retry")) && v.loads == loads && Handler.pending == null, "website page sentinel is swallowed and ignored");
    a.retryWebsite(); check(v.loads == loads && Handler.pending == null, "plugin retry from a website page is ignored");
    check(!a.handleOfflineRetryRequest(v, "fnf-offline://retry"), "sentinel refused off the offline page");
    int passed = v.client.passedThrough;
    check(!v.client.shouldOverrideUrlLoading(v, req("https://www.flynfeelholiday.com/domestic")) && v.client.passedThrough == passed + 1, "ordinary links keep Capacitor handling");
    // Stale flag: offline flag set but a website page is on screen.
    a = start(); v = a.getBridge().getWebView(); a.listener().onPageLoaded(v);
    v.client.onReceivedError(v, document, new android.webkit.WebResourceError());
    v.client.onPageStarted(v, v.url, null); a.listener().onPageLoaded(v);
    v.url = "https://www.flynfeelholiday.com/"; // view.getUrl() moved on before onPageStarted
    check(!a.handleOfflineRetryRequest(v, "fnf-offline://retry"), "stale offline flag cannot retry from website page");
    System.out.println("38 native offline controller checks passed (JVM fakes; not a device test).");
  }
}""",
}

with tempfile.TemporaryDirectory(prefix="fnf-startup-") as directory:
    temp = Path(directory)
    paths = []
    for name, text in SOURCES.items():
        path = temp / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        paths.append(str(path))
    paths.append(str(ROOT / "android/app/src/main/java/com/flynfeelholiday/app/MainActivity.java"))
    subprocess.run(["javac", "-d", str(temp / "classes"), *paths], check=True)
    subprocess.run(["java", "-cp", str(temp / "classes"), "StartupChecks"], check=True)