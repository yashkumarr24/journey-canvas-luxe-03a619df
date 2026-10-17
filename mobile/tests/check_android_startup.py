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
  public String getUrl() { return url; }
  public void stopLoading() { stops++; }
  public void loadUrl(String next) { url = next; loads++; }
}""",
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
  public void onCreate(Bundle state) { bridge = new Bridge(); }
  public void onDestroy() {}
  public boolean isFinishing() { return false; }
  public Bridge getBridge() { return bridge; }
  public WebViewListener listener() { return bridgeBuilder.listener; }
  public static class Builder {
    WebViewListener listener;
    public Builder addWebViewListener(WebViewListener value) { listener = value; return this; }
  }
  public static class Bridge {
    WebView view = new WebView();
    public String getErrorUrl() { return "https://localhost/index.html"; }
    public WebView getWebView() { return view; }
  }
}""",
    "StartupChecks.java": """import android.os.Handler;
import android.webkit.WebView;
import com.flynfeelholiday.app.MainActivity;
public class StartupChecks {
  static void check(boolean condition, String rule) { if (!condition) throw new AssertionError(rule); }
  static MainActivity start() { Handler.pending = null; MainActivity a = new MainActivity(); a.onCreate(null); return a; }
  public static void main(String[] args) {
    MainActivity a = start(); WebView v = a.getBridge().getWebView();
    check(Handler.pending != null && Handler.delay == 15000, "cold startup deadline is 15 seconds");
    Runnable original = Handler.pending;
    v.url = "https://www.flynfeelholiday.com/redirect"; a.listener().onPageStarted(v);
    check(Handler.pending == original, "redirect does not extend startup wait");
    Handler.fire();
    check(v.stops == 1 && v.loads == 1 && v.url.equals(a.getBridge().getErrorUrl()), "stall loads local fallback once");
    Handler.fire(); check(v.loads == 1, "no automatic retry loop");
    a.listener().onPageStarted(v); a.listener().onPageLoaded(v);
    check(Handler.pending == null, "local fallback cancels deadline");
    v.url = "https://www.flynfeelholiday.com/"; a.listener().onPageStarted(v);
    check(Handler.pending != null && Handler.delay == 15000, "manual offline retry gets a fresh deadline");
    a.listener().onPageLoaded(v); check(Handler.pending == null, "successful retry cancels deadline");
    v.url = "https://www.flynfeelholiday.com/auth/login?code=test"; a.listener().onPageStarted(v);
    check(Handler.pending == null, "warm OAuth and ordinary navigation are not timed");
    a = start(); a.onDestroy(); check(Handler.pending == null, "destroy cancels pending deadline");
    a = start(); v = a.getBridge().getWebView(); v.url = a.getBridge().getErrorUrl();
    a.listener().onPageStarted(v); check(Handler.pending == null, "immediate native load error cancels startup timeout");
    System.out.println("10 native startup controller checks passed (JVM fakes; not a device test).");
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