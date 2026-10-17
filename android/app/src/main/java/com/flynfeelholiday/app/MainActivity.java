package com.flynfeelholiday.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Only cold startup and a manual Retry from the bundled error page are timed.
    // Ordinary navigation and OAuth returns keep Capacitor's existing behaviour.
    private static final long STARTUP_TIMEOUT_MS = 15000;
    private final Handler startupHandler = new Handler(Looper.getMainLooper());
    private boolean startupPending = true;
    private boolean showingOffline = false;

    private final Runnable startupTimeout = () -> {
        if (!startupPending || bridge == null || isFinishing()) return;
        String errorUrl = bridge.getErrorUrl();
        if (errorUrl == null) return;
        startupPending = false;
        showingOffline = true;
        bridge.getWebView().stopLoading();
        bridge.getWebView().loadUrl(errorUrl);
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView view) {
                if (bridge == null) return;
                String url = view.getUrl();
                if (url != null && url.equals(bridge.getErrorUrl())) {
                    startupPending = false;
                    showingOffline = true;
                    startupHandler.removeCallbacks(startupTimeout);
                } else if (showingOffline) {
                    startupPending = true;
                    showingOffline = false;
                    armStartupTimeout();
                }
            }

            @Override
            public void onPageLoaded(WebView view) {
                startupHandler.removeCallbacks(startupTimeout);
                startupPending = false;
                showingOffline = bridge != null && view.getUrl() != null
                    && view.getUrl().equals(bridge.getErrorUrl());
            }
        });
        super.onCreate(savedInstanceState);
        if (bridge != null && startupPending) armStartupTimeout();
    }

    private void armStartupTimeout() {
        startupHandler.removeCallbacks(startupTimeout);
        startupHandler.postDelayed(startupTimeout, STARTUP_TIMEOUT_MS);
    }

    @Override
    public void onDestroy() {
        startupHandler.removeCallbacks(startupTimeout);
        super.onDestroy();
    }
}
