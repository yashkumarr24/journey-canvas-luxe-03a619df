import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkle, X } from "lucide-react";

const SESSION_KEY = "fnf-ai-welcome-seen";

/** Shown once per browser session, shortly after the first page load; opens the existing Ask AI drawer. */
export function AssistantWelcomePopup({ onOpenChat }: { onOpenChat: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => {
      setVisible(true);
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVisible(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div role="dialog" aria-modal="false" aria-label="Ask AI travel assistant" className="fixed inset-x-3 bottom-4 z-40 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[min(36rem,calc(100vw-3rem))]">
      <div className="ai-glow-ring flex items-center gap-1 rounded-full pr-2">
        <button
          type="button"
          onClick={() => { setVisible(false); onOpenChat(); }}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-4 rounded-full px-6 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <Sparkle className="size-5 shrink-0 fill-foreground text-foreground" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-base font-medium text-foreground/75">Hotels in Dubai with free cancellation</span>
            <span className="sr-only">Open the Ask AI travel assistant</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Close Ask AI suggestion"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
