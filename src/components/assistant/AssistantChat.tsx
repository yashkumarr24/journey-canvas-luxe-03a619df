import { useEffect, useRef, useState } from "react";
import { Compass, RefreshCcw, RotateCcw } from "lucide-react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
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

export function AssistantChat({ messages, pending, error, suggestions, suggestedPrompts, isDemo, onSend, onRetry, onReset }: AssistantChatProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chips = suggestions.length > 0 ? suggestions : messages.length <= 1 ? suggestedPrompts : [];

  useEffect(() => { inputRef.current?.focus(); }, [pending]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Compass className="size-4" /></span>
          <div className="min-w-0"><p className="truncate font-display text-lg">Trip finder</p><p className="truncate text-xs text-muted-foreground">{isDemo ? "Demo mode · guided search" : "Flights and stays from live results"}</p></div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onReset} title="New trip"><RotateCcw /></Button>
      </header>

      <Conversation className="min-h-0">
        <ConversationContent className="gap-5 px-4 py-5 sm:px-5">
          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent className={message.kind === "error" ? "text-destructive" : message.role === "user" ? "bg-primary text-primary-foreground" : ""}>
                <MessageResponse>{message.text}</MessageResponse>
              </MessageContent>
            </Message>
          ))}
          {pending && <Message from="assistant"><MessageContent><Shimmer>Understanding your trip…</Shimmer></MessageContent></Message>}
          {error?.retryable && !pending ? <Button variant="outline" size="sm" onClick={onRetry} className="w-fit"><RefreshCcw />Try again</Button> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {chips.length > 0 ? <div className="flex gap-2 overflow-x-auto border-t border-border px-4 py-3 sm:flex-wrap sm:px-5">{chips.map((chip) => <Button key={chip} variant="outline" size="sm" disabled={pending} onClick={() => onSend(chip)} className="shrink-0 font-normal">{chip}</Button>)}</div> : null}

      <div className="border-t border-border p-3 sm:p-4">
        <PromptInput onSubmit={({ text }) => { const trimmed = text.trim(); if (!trimmed || pending) return; setValue(""); onSend(trimmed); }} className="rounded-lg border-border bg-card shadow-none">
          <PromptInputTextarea ref={inputRef} value={value} onChange={(event) => setValue(event.target.value.slice(0, MAX_ASSISTANT_MESSAGE_LENGTH))} placeholder="Ask for flights, stays, timing or price…" className="min-h-20" />
          <PromptInputFooter className="justify-end"><PromptInputSubmit status={pending ? "submitted" : "ready"} disabled={pending || value.trim().length === 0} /></PromptInputFooter>
        </PromptInput>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Search details are checked before any provider request.</p>
      </div>
    </div>
  );
}