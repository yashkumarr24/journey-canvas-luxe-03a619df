package com.flynfeelholiday.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OfflineNavigation")
public class OfflineNavigation extends Plugin {
    @PluginMethod
    public void retry(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).retryWebsite();
                call.resolve();
            } else {
                call.reject("Offline navigation unavailable");
            }
        });
    }

    @PluginMethod
    public void showOffline(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).showOffline();
                call.resolve();
            } else {
                call.reject("Offline navigation unavailable");
            }
        });
    }
}