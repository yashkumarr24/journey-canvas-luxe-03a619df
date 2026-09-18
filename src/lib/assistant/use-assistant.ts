/**
 * Conversation state for the AI Travel Assistant (PHASE 12).
 *
 * Owns the message list, the accumulated requirements, the loading/error state
 * and the assistant analytics events. It talks only to `assistantApi`, so the
 * demo provider and the future backend AI endpoint are interchangeable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
}

export function useAssistant(): UseAssistantResult {
  const { track } = useAnalytics();
  const [messages, setMessages] = useState<AssistantMessage[]>([GREETING]);
  const [requirements, setRequirements] = useState<TravelRequirements>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AssistantApiError | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const lastMessage = useRef<string | null>(null);
  // Requirements are also held in a ref so two messages sent in quick
  // succession always merge onto the latest understanding, never a stale one.
  const requirementsRef = useRef<TravelRequirements>({});
  const readyTracked = useRef(false);
  const hydrated = useRef(false);

  // Restore any in-tab conversation after hydration (never during render).
  useEffect(() => {
    const restored = loadAssistantSession();
    if (restored.messages.length > 0) {
      setMessages(restored.messages);
      setRequirements(restored.requirements);
      requirementsRef.current = restored.requirements;
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    requirementsRef.current = requirements;
  }, [requirements]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveAssistantSession({ messages, requirements });
  }, [messages, requirements]);

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

        requirementsRef.current = response.requirements;
        setRequirements(response.requirements);
        setSuggestions(response.suggestions ?? []);
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", response.reply, response.missing.length > 0 ? "question" : "summary"),
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
    setError(null);
    readyTracked.current = false;
    lastMessage.current = null;
  }, []);

  const missing = missingRequirements(requirements);

  return {
    messages,
    requirements,
    missing,
    ready: missing.length === 0,
    pending,
    error,
    suggestions,
    isDemo: useDemoAssistant,
    send,
    retry,
    reset,
    setRequirements,
  };
}
