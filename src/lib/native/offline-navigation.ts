import { registerPlugin } from "@capacitor/core";

const offlineNavigation = registerPlugin<{ showOffline(): Promise<void>; retry(): Promise<void> }>("OfflineNavigation");
let requested = false;

export async function retryNativeWebsite(): Promise<void> {
  try { await offlineNavigation.retry(); } catch { /* Older shells remain on the current page. */ }
}

/** Only route-load/network errors, never resource element errors or business responses. */
export function isNavigationNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|loading (?:css )?chunk|chunkloaderror|failed to (?:fetch dynamically imported module|load module script)|err_internet_disconnected/i.test(message);
}

export async function showNativeOffline(): Promise<void> {
  if (requested) return;
  requested = true;
  try {
    await offlineNavigation.showOffline();
  } catch {
    // Older installed shells lack this plugin; never navigate to an unserved local URL.
    requested = false;
  }
}