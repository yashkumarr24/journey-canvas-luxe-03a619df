/**
 * Assistant session state (PHASE 12).
 *
 * Phase 12 needs NO database table: the conversation is a short-lived planning
 * aid, so it lives in the tab's sessionStorage and disappears when the tab is
 * closed. Nothing sensitive is stored — no traveller documents, no payment data,
 * no fares, no fare ids.
 */

import type { AssistantMessage, AssistantMessageKind, AssistantRole, TravelRequirements } from "@/types/assistant";

const STORAGE_KEY = "fnf.assistant.session.v1";
const MAX_MESSAGES = 40;

export interface AssistantSessionState {
  messages: AssistantMessage[];
  requirements: TravelRequirements;
}

export const emptyAssistantSession: AssistantSessionState = { messages: [], requirements: {} };

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMessage(
  role: AssistantRole,
  text: string,
  kind: AssistantMessageKind = "text",
): AssistantMessage {
  return { id: newId(), role, text, at: new Date().toISOString(), kind };
}

export function loadAssistantSession(): AssistantSessionState {
  if (typeof window === "undefined") return emptyAssistantSession;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAssistantSession;
    const parsed = JSON.parse(raw) as AssistantSessionState;
    if (!Array.isArray(parsed.messages)) return emptyAssistantSession;
    return {
      messages: parsed.messages.slice(-MAX_MESSAGES),
      requirements: parsed.requirements ?? {},
    };
  } catch {
    return emptyAssistantSession;
  }
}

export function saveAssistantSession(state: AssistantSessionState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: state.messages.slice(-MAX_MESSAGES), requirements: state.requirements }),
    );
  } catch {
    // Storage full or blocked — the assistant keeps working in memory.
  }
}

export function clearAssistantSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
