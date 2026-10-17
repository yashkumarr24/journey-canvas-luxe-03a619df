package com.flynfeelholiday.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Only cold startup and a manual Retry from the bundled error page are timed.
    // Ordinary navigation and OAuth returns keep Capacitor's existing behaviour.
    private static final long STARTUP_TIMEOUT_MS = 15000;
    private final Handler startupHandler = new Handler(Looper.getMainLooper());
    private boolean startupPending = true;
    private boolean showingOffline = false;
    private boolean fallbackRequested = false;
    private boolean clearHistoryAfterRecovery = false;
    private OnBackPressedCallback offlineBack;

    private final Runnable startupTimeout = () -> {
        if (!startupPending || bridge == null || isFinishing()) return;
        showOffline();
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfflineNavigation.class);
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
                    clearHistoryAfterRecovery = true;
                    if (offlineBack != null) offlineBack.setEnabled(false);
                    armStartupTimeout();
                }
            }

            @Override
            public void onPageLoaded(WebView view) {
                if (bridge == null || view.getUrl() == null) return;
                if (fallbackRequested && !view.getUrl().equals(bridge.getErrorUrl())) return;
                startupHandler.removeCallbacks(startupTimeout);
                startupPending = false;
                showingOffline = bridge != null && view.getUrl() != null
                    && view.getUrl().equals(bridge.getErrorUrl());
                if (showingOffline || clearHistoryAfterRecovery) {
                    // Remove navigation entries, not cookies/localStorage or the OAuth verifier.
                    view.clearHistory();
                    clearHistoryAfterRecovery = false;
                }
                if (showingOffline) fallbackRequested = false;
                if (offlineBack != null) offlineBack.setEnabled(showingOffline);
            }
        });
        super.onCreate(savedInstanceState);
        offlineBack = new OnBackPressedCallback(showingOffline || fallbackRequested) {
            @Override public void handleOnBackPressed() { finish(); }
        };
        getOnBackPressedDispatcher().addCallback(this, offlineBack);
        if (bridge != null && startupPending) armStartupTimeout();
    }

    @Override
    protected void load() {
        super.load();
        if (bridge == null) return;
        // Keep Capacitor interception, bridge resets and OAuth intents. Override only
        // main-document failures; its stock handler can leave a raw error history entry.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
                else super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showOffline();
                else super.onReceivedHttpError(view, request, response);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (fallbackRequested && !url.equals(bridge.getErrorUrl())) return;
                super.onPageFinished(view, url);
            }
        });
    }

    public void showOffline() {
        if (bridge == null || isFinishing() || fallbackRequested || showingOffline) return;
        String errorUrl = bridge.getErrorUrl();
        if (errorUrl == null) return;
        fallbackRequested = true;
        startupPending = false;
        startupHandler.removeCallbacks(startupTimeout);
        if (offlineBack != null) offlineBack.setEnabled(true);
        WebView view = bridge.getWebView();
        view.stopLoading();
        // Queue after the failing WebView callback, so its default error cannot win.
        view.post(() -> {
            if (!isFinishing()) view.loadUrl(errorUrl);
        });
    }

    public void retryWebsite() {
        if (bridge == null || isFinishing() || startupPending) return;
        // Clear stale flags first: a failed retry must be allowed to reach
        // showOffline() again, so the branded page returns within the deadline.
        fallbackRequested = false;
        showingOffline = false;
        startupPending = true;
        clearHistoryAfterRecovery = true;
        if (offlineBack != null) offlineBack.setEnabled(false);
        armStartupTimeout();
        bridge.getWebView().loadUrl("https://www.flynfeelholiday.com/");
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
