/**
 * True only inside the Fly n Feel Android/iOS app. Reads the bridge object the
 * native shell injects; never imports Capacitor, so the website bundle and SSR
 * are unaffected. Call from effects or event handlers only (not during render).
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}
