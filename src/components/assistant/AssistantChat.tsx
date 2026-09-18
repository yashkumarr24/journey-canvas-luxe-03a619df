import { useEffect, useRef, useState } from "react";
import { RefreshCcw, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_ASSISTANT_MESSAGE_LENGTH } from "@/lib/assistant/requirements";
import type { AssistantMessage } from "@/types/assistant";
import type { AssistantApiError } from "@/lib/assistant/assistant-api";

export interface AssistantChatProps {
  messages: AssistantMessage[];
  pending: boolean;
  error: AssistantApiError | null;
  suggestions: string[];
  suggestedPrompts: string[];
  isDemo: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onReset: () => void;
}

function Bubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === "user";
  const tone = message.kind === "error" ? "border-destructive/40 bg-destructive/5" : "border-foreground/10 bg-[#F8F8F6]";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl border px-4 py-3 text-sm leading-relaxed sm:max-w-[75%] ${
          isUser ? "border-transparent bg-foreground text-background" : `${tone} text-foreground`
        }`}
      >
        {!isUser && (
          <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Assistant</p>
        )}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
}

export function AssistantChat({
  messages,
  pending,
  error,
  suggestions,
  suggestedPrompts,
  isDemo,
  onSend,
  onRetry,
  onReset,
}: AssistantChatProps) {
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  const submit = () => {
    const text = value.trim();
    if (!text || pending) return;
    setValue("");
    onSend(text);
  };

  const chips = suggestions.length > 0 ? suggestions : messages.length <= 1 ? suggestedPrompts : [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-background shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-[#d62828]/10 text-[#d62828]">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="font-display text-lg leading-none">Travel assistant</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isDemo
                ? "Demo mode — guided pattern matching, not a live AI model yet"
                : "Understands your request and prepares a live flight search"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} className="gap-1 text-xs">
          <RotateCcw className="size-3.5" /> New chat
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-5">
        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}

        {pending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl border border-foreground/10 bg-[#F8F8F6] px-4 py-3">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
              <span className="ml-2 text-xs text-muted-foreground">Working on it…</span>
            </div>
          </div>
        )}

        {error?.retryable && !pending && (
          <div className="flex justify-start">
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
              <RefreshCcw className="size-3.5" /> Try again
            </Button>
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-foreground/10 px-4 py-3 sm:px-5">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onSend(chip)}
              disabled={pending}
              className="rounded-full border border-foreground/15 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 border-t border-foreground/10 px-4 py-3 sm:px-5"
      >
        <label className="sr-only" htmlFor="assistant-input">
          Describe your trip
        </label>
        <textarea
          id="assistant-input"
          value={value}
          onChange={(event) => setValue(event.target.value.slice(0, MAX_ASSISTANT_MESSAGE_LENGTH))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="e.g. Ahmedabad to Dubai next month for 5 days, economy, morning flight"
          className="min-h-11 flex-1 resize-none rounded-2xl border border-foreground/15 bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/35"
        />
        <Button type="submit" disabled={pending || value.trim().length === 0} className="gap-1.5">
          <Send className="size-4" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
    </div>
  );
}
