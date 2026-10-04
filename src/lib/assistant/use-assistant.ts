/**
 * Conversation state for the AI Travel Assistant (PHASE 12).
 *
 * Owns the message list, the accumulated requirements, the loading/error state
 * and the assistant analytics events. It talks only to `assistantApi`, so the
 * demo provider and the future backend AI endpoint are interchangeable.
 */

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { useAnalytics } from "@/lib/analytics/tracker";
import type { AssistantMessage, MissingRequirement, TravelRequirements } from "@/types/assistant";
import { assistantApi, toAssistantError, useDemoAssistant, type AssistantApiError } from "./assistant-api";
import {
  clearAssistantSession,
  createMessage,
  loadAssistantSession,
  saveAssistantSession,
} from "./assistant-session";
import { missingRequirements, sanitizeAssistantMessage } from "./requirements";
import { preserveStatedDetails, confirmFromTurn, nextGuidedStep, type ConfirmedSteps, type GuidedStep } from "./guided-steps";

const GREETING = createMessage(
  "assistant",
  "Tell me where you want to go, when you want to travel, and whether you need a stay. I’ll turn it into a flight and hotel search.",
  "text",
);

export const SUGGESTED_PROMPTS = [
  "Ahmedabad to Mumbai tomorrow, stay 4 nights, return in the evening",
  "One-way Mumbai to Singapore on 12 March for 2 adults",
  "Delhi to Bangkok next week, non-stop only, business class",
  "Family trip: Bengaluru to Goa this weekend, 2 adults, 1 child and a hotel",
];

export interface UseAssistantResult {
  messages: AssistantMessage[];
  requirements: TravelRequirements;
  missing: MissingRequirement[];
  ready: boolean;
  pending: boolean;
  error: AssistantApiError | null;
  suggestions: string[];
  isDemo: boolean;
  send: (text: string) => void;
  retry: () => void;
  reset: () => void;
  /** Directly patch requirements after a validation failure, if ever needed. */
  setRequirements: (next: TravelRequirements) => void;
  /** Next control-driven step, or null. */
  guidedStep: GuidedStep | null;
  /** Apply a control selection locally. Never sent to the AI. */
  answerStep: (step: GuidedStep, patch: TravelRequirements) => void;
}

function useAssistantState(): UseAssistantResult {
  const { track } = useAnalytics();
  const [messages, setMessages] = useState<AssistantMessage[]>([GREETING]);
  const [requirements, setRequirements] = useState<TravelRequirements>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AssistantApiError | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedSteps>({});
  const lastMessage = useRef<string | null>(null);
  // Requirements are also held in a ref so two messages sent in quick
  // succession always merge onto the latest understanding, never a stale one.
  const requirementsRef = useRef<TravelRequirements>({});
  // Values picked with guided controls. UI selections are the source of truth
  // and always win over whatever a later AI turn returns.
  const selectedRef = useRef<TravelRequirements>({});
  const confirmedRef = useRef<ConfirmedSteps>({});
  const readyTracked = useRef(false);
  const hydrated = useRef(false);

  // Restore any in-tab conversation after hydration (never during render).
  useEffect(() => {
    const restored = loadAssistantSession();
    if (restored.messages.length > 0) {
      setMessages(restored.messages);
      setRequirements(restored.requirements);
      requirementsRef.current = restored.requirements;
      setConfirmed(restored.confirmed ?? {});
      confirmedRef.current = restored.confirmed ?? {};
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    requirementsRef.current = requirements;
  }, [requirements]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveAssistantSession({ messages, requirements, confirmed });
  }, [messages, requirements, confirmed]);

  const run = useCallback(
    async (text: string, history: AssistantMessage[]) => {
      setPending(true);
      setError(null);
      try {
        const response = await assistantApi.interpret({
          message: text,
          requirements: requirementsRef.current,
          history: history.map((m) => ({ role: m.role, text: m.text })),
        });

        const preserved = { ...preserveStatedDetails(text, response.requirements), ...selectedRef.current };
        const nextConfirmed = confirmFromTurn(text, preserved, confirmedRef.current);
        requirementsRef.current = preserved;
        confirmedRef.current = nextConfirmed;
        setRequirements(preserved);
        setConfirmed(nextConfirmed);
        setSuggestions(response.suggestions ?? []);
        // When guided controls take over, they ask the questions; don't also
        // show the AI's own question, which would duplicate or contradict them.
        const guidedNext = nextGuidedStep(preserved, nextConfirmed);
        const reply = guidedNext ? "Thanks — just pick the remaining details below." : response.reply;
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", reply, guidedNext || response.missing.length > 0 ? "question" : "summary"),
        ]);
        track(ANALYTICS_EVENTS.assistantResponseReceived, {
          provider: response.provider,
          missingCount: response.missing.length,
          ready: response.ready,
        });
        if (response.ready && !readyTracked.current) {
          readyTracked.current = true;
          track(ANALYTICS_EVENTS.assistantRequirementsReady, {
            tripType: response.requirements.tripType ?? "oneway",
            cabinClass: response.requirements.cabinClass ?? "economy",
            nonStopOnly: response.requirements.nonStopOnly ?? false,
          });
        }
      } catch (caught) {
        const failure = toAssistantError(caught);
        setError(failure);
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", failure.message, "error"),
        ]);
        track(ANALYTICS_EVENTS.assistantFailed, { rateLimited: failure.rateLimited });
      } finally {
        setPending(false);
      }
    },
    [track],
  );

  const send = useCallback(
    (raw: string) => {
      const text = sanitizeAssistantMessage(raw);
      if (!text || pending) return;
      lastMessage.current = text;
      setSuggestions([]);
      const userMessage = createMessage("user", text, "text");
      const history = [...messages, userMessage];
      setMessages(history);
      track(ANALYTICS_EVENTS.assistantMessageSent, { length: text.length });
      void run(text, history);
    },
    [messages, pending, run, track],
  );

  const retry = useCallback(() => {
    if (!lastMessage.current || pending) return;
    void run(lastMessage.current, messages);
  }, [messages, pending, run]);

  const reset = useCallback(() => {
    clearAssistantSession();
    setMessages([GREETING]);
    setRequirements({});
    requirementsRef.current = {};
    setSuggestions([]);
    setConfirmed({});
    confirmedRef.current = {};
    selectedRef.current = {};
    setError(null);
    readyTracked.current = false;
    lastMessage.current = null;
  }, []);

  const answerStep = useCallback((step: GuidedStep, patch: TravelRequirements) => {
    selectedRef.current = { ...selectedRef.current, ...patch };
    const next = { ...requirementsRef.current, ...patch };
    const nextConfirmed: ConfirmedSteps = { ...confirmedRef.current, [step]: true };
    requirementsRef.current = next;
    confirmedRef.current = nextConfirmed;
    setRequirements(next);
    setConfirmed(nextConfirmed);
    if (nextGuidedStep(next, nextConfirmed) === null && missingRequirements(next).length === 0) {
      setMessages((prev) => [...prev, createMessage("assistant", "Got it — searching your trip now.", "summary")]);
    }
  }, []);

  const missing = missingRequirements(requirements);
  const guidedStep = nextGuidedStep(requirements, confirmed);

  return {
    messages,
    requirements,
    missing,
    ready: missing.length === 0 && guidedStep === null,
    pending,
    error,
    suggestions,
    isDemo: useDemoAssistant,
    send,
    retry,
    reset,
    setRequirements,
    guidedStep,
    answerStep,
  };
}

/**
 * One shared assistant session for the whole app: the header Ask AI drawer,
 * Menu → Plan with AI and the /assistant page all read and write the same
 * state, so a trip completed in the drawer is exactly the trip the page searches.
 */
const AssistantContext = createContext<UseAssistantResult | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const value = useAssistantState();
  return createElement(AssistantContext.Provider, { value }, children);
}

export function useAssistant(): UseAssistantResult {
  const shared = useContext(AssistantContext);
  if (!shared) throw new Error("useAssistant must be used inside AssistantProvider");
  return shared;
}
