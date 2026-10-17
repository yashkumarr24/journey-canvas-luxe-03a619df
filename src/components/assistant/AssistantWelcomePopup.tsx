import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const EXAMPLE_TEXT = "Hotels in Dubai with free cancellation";
const SHOW_DELAY_MS = 2500;
const UNROLL_MS = 700;
const TYPE_MS = 45;

/** Shown on every page load, shortly after load; unrolls from the left like paper and opens the existing Ask AI drawer. */
export function AssistantWelcomePopup({ onOpenChat }: { onOpenChat: () => void }) {
  const [visible, setVisible] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!visible) return;
    document.body.classList.add("assistant-suggestion-visible");
    return () => document.body.classList.remove("assistant-suggestion-visible");
  }, [visible]);

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVisible(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  // Typewriter for the example prompt, starting once the unroll finishes.
  useEffect(() => {
    if (!visible) return;
    let i = 0;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        i += 1;
        setTyped(EXAMPLE_TEXT.slice(0, i));
        if (i >= EXAMPLE_TEXT.length && interval) window.clearInterval(interval);
      }, TYPE_MS);
    }, UNROLL_MS);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div role="dialog" aria-modal="false" aria-label="Ask AI travel assistant" className="assistant-suggestion fixed inset-x-3 z-40 sm:inset-x-auto sm:left-6 sm:w-[min(36rem,calc(100vw-3rem))]">
      <div className="ai-glow-ring ai-unroll grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-full pr-2">
        <Button variant="ghost"
          type="button"
          onClick={() => { setVisible(false); onOpenChat(); }}
          className="h-14 min-w-0 justify-start gap-3 rounded-full px-3 py-3 text-left focus-visible:ring-gold sm:px-6"
        >
          <Sparkle className="size-5 shrink-0 fill-foreground text-foreground" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-base font-medium text-foreground/75">
              {typed}
              <span aria-hidden="true" className="ai-caret">|</span>
            </span>
            <span className="sr-only">Open the Ask AI travel assistant</span>
          </span>
        </Button>
        <Button variant="ghost"
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Close Ask AI suggestion"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
