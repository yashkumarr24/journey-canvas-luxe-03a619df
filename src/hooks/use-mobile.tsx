import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
    () => false,
  );
}
