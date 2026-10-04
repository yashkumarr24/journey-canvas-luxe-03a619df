import { Plane } from "lucide-react";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { AssistantSearchResults } from "@/components/assistant/AssistantSearchResults";
import { GuidedStepControl } from "@/components/assistant/GuidedStepControl";
import { TravelSummaryCard } from "@/components/assistant/TravelSummaryCard";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAssistantSearch } from "@/lib/assistant/use-assistant-search";

const drawerPrompts = [
  "Find flights from Ahmedabad to Mumbai",
  "Find a hotel in Dubai",
  "Find a flight with baggage",
  "Plan my trip",
];

export function AssistantDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const search = useAssistantSearch({ active: open });
  const { assistant } = search;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" overlayClassName="z-[65]" className="z-[70] flex h-dvh w-screen max-w-none flex-col gap-0 overflow-y-auto border-0 p-0 sm:max-w-none lg:grid lg:grid-cols-[430px_minmax(0,1fr)] lg:overflow-hidden">
        <div className="sr-only">
          <SheetTitle>Ask AI</SheetTitle>
          <SheetDescription>Describe your trip and view validated flight and hotel results beside the conversation.</SheetDescription>
        </div>
        <aside className="flex h-[64dvh] min-h-[520px] flex-col border-b border-border bg-background lg:h-dvh lg:min-h-0 lg:border-b-0 lg:border-r">
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
            onReset={() => { assistant.reset(); search.clearSearch(); }}
            guided={assistant.guidedStep ? <GuidedStepControl step={assistant.guidedStep} requirements={assistant.requirements} onAnswer={assistant.answerStep} /> : null}
          />
          </div>
        </aside>

        <section className="min-h-[36dvh] bg-muted/40 px-4 py-6 sm:px-7 lg:h-dvh lg:min-h-0 lg:overflow-y-auto lg:px-10 lg:py-8">
          <div className="mx-auto max-w-5xl">
            <div className="pr-10">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">AI travel search</p>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl">Your Trip</h1>
            </div>
            <div className="mt-5">
              <TravelSummaryCard requirements={assistant.requirements} missing={assistant.missing} issues={search.issues} canSearch={search.canSearch} searching={search.searching} onChange={() => undefined} />
            </div>
            {search.hasSearch ? (
              <div className="mt-8"><AssistantSearchResults search={search} /></div>
            ) : (
              <div className="mt-8 grid min-h-64 place-items-center rounded-lg border border-dashed border-border bg-background/70 p-8 text-center">
                <div><div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Plane /></div><h2 className="mt-4 font-display text-2xl">Ready when your trip is</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Complete the trip details in the conversation. Live flights and stays will appear here automatically.</p></div>
              </div>
            )}
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}