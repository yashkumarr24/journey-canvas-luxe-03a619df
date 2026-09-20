import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, Compass, Search } from "lucide-react";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAssistant } from "@/lib/assistant/use-assistant";

const drawerPrompts = [
  "Find flights from Ahmedabad to Mumbai",
  "Find a hotel in Dubai",
  "Find a flight with baggage",
  "Plan my trip",
];

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const assistant = useAssistant();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-5 left-4 z-40 h-11 border border-primary bg-background px-4 text-foreground shadow-[var(--shadow-soft)] hover:bg-primary hover:text-primary-foreground sm:bottom-auto sm:left-5 sm:top-1/2 sm:-translate-y-1/2 sm:[writing-mode:vertical-rl] sm:h-auto sm:min-h-32 sm:w-12 sm:px-0 sm:py-4"
          aria-label="Open Ask AI travel assistant"
        >
          <Bot className="size-4 sm:rotate-90" aria-hidden="true" />
          <span>Ask AI</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-[min(100vw,460px)] max-w-none flex-col gap-0 p-0 sm:max-w-[460px]">
        <div className="sr-only">
          <SheetTitle>Ask AI</SheetTitle>
          <SheetDescription>Describe your trip and continue to validated flight and hotel results.</SheetDescription>
        </div>
        <div className="border-b border-border px-5 py-4 pr-14">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase text-primary"><Compass className="size-4" />Ask AI</p>
          <p className="mt-1 text-sm text-muted-foreground">Describe your trip in your own words.</p>
        </div>
        <div className="min-h-0 flex-1">
          <AssistantChat
            messages={assistant.messages}
            pending={assistant.pending}
            error={assistant.error}
            suggestions={assistant.suggestions}
            suggestedPrompts={drawerPrompts}
            isDemo={assistant.isDemo}
            onSend={assistant.send}
            onRetry={assistant.retry}
            onReset={assistant.reset}
          />
        </div>
        <div className="border-t border-border bg-card p-4">
          <Button asChild className="w-full" disabled={!assistant.ready}>
            <Link to="/assistant" onClick={() => setOpen(false)}>
              <Search className="size-4" />
              {assistant.ready ? "Review trip & search results" : "Add trip details to continue"}
            </Link>
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Results come only from the existing flight and hotel search services.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}