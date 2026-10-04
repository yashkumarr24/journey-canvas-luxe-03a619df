import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { GuidedStepControl } from "@/components/assistant/GuidedStepControl";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAssistant } from "@/lib/assistant/use-assistant";

const drawerPrompts = [
  "Find flights from Ahmedabad to Mumbai",
  "Find a hotel in Dubai",
  "Find a flight with baggage",
  "Plan my trip",
];

export function AssistantDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const assistant = useAssistant();
  const navigate = useNavigate();
  // Once the trip is complete, go straight to results — no extra button.
  useEffect(() => {
    if (!open || !assistant.ready) return;
    onOpenChange(false);
    void navigate({ to: "/assistant", search: { run: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assistant.ready]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" overlayClassName="z-[65]" className="z-[70] flex w-[min(100vw,460px)] max-w-none flex-col gap-0 p-0 sm:max-w-[460px]">
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
            guided={assistant.guidedStep ? <GuidedStepControl step={assistant.guidedStep} requirements={assistant.requirements} onAnswer={assistant.answerStep} /> : null}
          />
        </div>
        <p className="border-t border-border bg-card p-4 text-center text-[11px] text-muted-foreground">Results open automatically once your trip details are complete.</p>
      </SheetContent>
    </Sheet>
  );
}