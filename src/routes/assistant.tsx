import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plane } from "lucide-react";
import { Nav } from "@/components/Nav";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { AssistantSearchResults } from "@/components/assistant/AssistantSearchResults";
import { GuidedStepControl } from "@/components/assistant/GuidedStepControl";
import { TravelSummaryCard } from "@/components/assistant/TravelSummaryCard";
import { Button } from "@/components/ui/button";
import { SUGGESTED_PROMPTS } from "@/lib/assistant/use-assistant";
import { useAssistantSearch } from "@/lib/assistant/use-assistant-search";
import { useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

export const Route = createFileRoute("/assistant")({
  head: () => ({ meta: [
    { title: "AI Flight & Hotel Search | Fly n Feel Holidays" },
    { name: "description", content: "Describe one trip and search available flights and hotels through Fly n Feel Holidays." },
    { property: "og:title", content: "AI Flight & Hotel Search | Fly n Feel Holidays" },
    { property: "og:description", content: "Turn natural travel plans into validated flight and hotel searches." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AssistantPage,
});

function AssistantPage() {
  const search = useAssistantSearch();
  const { assistant } = search;
  const chatInputAnchor = useRef<HTMLDivElement | null>(null);
  const [panelCompact, setPanelCompact] = useState(false);

  useTrackOnce(ANALYTICS_EVENTS.assistantOpened, true, { mode: assistant.isDemo ? "demo" : "ai" });
  useEffect(() => { if (assistant.pending) setPanelCompact(false); }, [assistant.pending]);

  return (
    <main className="min-h-screen bg-muted/40">
      <Nav />
      <div className="mx-auto flex min-h-screen max-w-[1600px] pt-20 lg:h-screen lg:overflow-hidden">
        <aside className={`${panelCompact ? "lg:w-20" : "lg:w-[390px] xl:w-[430px]"} relative flex min-h-[calc(100vh-5rem)] w-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-300 lg:min-h-0`}>
          <div ref={chatInputAnchor} className={panelCompact ? "hidden lg:block lg:flex-1" : "min-h-0 flex-1"}>
            {panelCompact ? (
              <div className="flex h-full flex-col items-center gap-4 py-6"><Plane className="size-5 text-primary" /><span className="[writing-mode:vertical-rl] text-xs uppercase tracking-[0.18em] text-muted-foreground">Trip finder</span></div>
            ) : (
              <AssistantChat messages={assistant.messages} pending={assistant.pending} error={assistant.error} suggestions={assistant.suggestions} suggestedPrompts={SUGGESTED_PROMPTS} isDemo={assistant.isDemo} onSend={assistant.send} onRetry={assistant.retry} onReset={() => { assistant.reset(); search.clearSearch(); }} guided={assistant.guidedStep ? <GuidedStepControl step={assistant.guidedStep} requirements={assistant.requirements} onAnswer={assistant.answerStep} /> : null} />
            )}
          </div>
          <Button variant="outline" size="icon-sm" onClick={() => setPanelCompact((value) => !value)} className="absolute -right-4 top-5 z-10 hidden rounded-full bg-background lg:inline-flex" title={panelCompact ? "Expand assistant" : "Collapse assistant"}>{panelCompact ? <ChevronRight /> : <ChevronLeft />}</Button>
        </aside>

        <section className={`${panelCompact ? "lg:pl-12" : ""} hidden min-w-0 flex-1 overflow-y-auto px-5 py-7 transition-[padding] sm:px-8 lg:block lg:px-10`}>
          <div className="mx-auto max-w-5xl">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">AI travel search</p><h1 className="mt-2 font-display text-4xl">Your Trip</h1><p className="mt-2 text-sm text-muted-foreground">One request, actual flight and hotel results, existing secure booking flow.</p></div>{assistant.isDemo ? <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">Demo mode</span> : null}</div>
            <div className="mt-6"><TravelSummaryCard requirements={assistant.requirements} missing={assistant.missing} issues={search.issues} canSearch={search.canSearch} searching={search.searching} onChange={() => { setPanelCompact(false); chatInputAnchor.current?.scrollIntoView({ behavior: "smooth" }); }} /></div>
            {search.hasSearch ? <div className="mt-8"><AssistantSearchResults search={search} /></div> : <EmptyWorkspace />}
          </div>
        </section>

        <section className="w-full px-4 py-5 lg:hidden">
          <div className="space-y-5"><TravelSummaryCard requirements={assistant.requirements} missing={assistant.missing} issues={search.issues} canSearch={search.canSearch} searching={search.searching} onChange={() => chatInputAnchor.current?.scrollIntoView({ behavior: "smooth" })} />{search.hasSearch ? <AssistantSearchResults search={search} /> : null}</div>
        </section>
      </div>
    </main>
  );
}

function EmptyWorkspace() {
  return <div className="mt-8 grid min-h-72 place-items-center rounded-lg border border-dashed border-border bg-background/70 p-8 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Plane /></div><h2 className="mt-4 font-display text-2xl">Ready when your trip is</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Once the route and dates are understood, available flights and stays appear here.</p></div></div>;
}