/**
 * The single network boundary for the AI Travel Assistant (PHASE 12).
 *
 * Components never call a provider directly. Today this resolves to the local
 * demo provider; once the backend AI endpoint is live (and VITE_BOOKING_API_URL
 * is set) the same call goes to `POST /api/v1/assistant/interpret`, which owns
 * the model credentials. No AI key ever exists in the browser.
 *
 * Whatever the source, the returned requirements are re-validated locally with
 * the shared flight-search schema before they can become a search.
 */

import { bookingApi, isBookingApiConfigured, toBookingError } from "@/lib/booking-api";
import type { AssistantTurnRequest, AssistantTurnResponse, TravelRequirements } from "@/types/assistant";
import { createDemoAssistantProvider } from "./assistant-mock";
import {
  isReady,
  missingRequirements,
  sanitizeAssistantMessage,
} from "./requirements";

/** Force the demo provider even when a backend is configured. */
const FORCED_DEMO = import.meta.env.VITE_ASSISTANT_DEMO_MODE === "true";

/** True while the assistant runs on the local demo provider. */
export const useDemoAssistant = FORCED_DEMO || !isBookingApiConfigured;

const demoProvider = createDemoAssistantProvider();

/** Only the last few turns travel to the server; never documents or payment data. */
const HISTORY_LIMIT = 8;

function trimHistory(history: AssistantTurnRequest["history"]) {
  return history.slice(-HISTORY_LIMIT).map((entry) => ({
    role: entry.role,
    text: sanitizeAssistantMessage(entry.text),
  }));
}

/** Re-derive gaps and readiness locally — server output is never trusted as-is. */
function harden(response: AssistantTurnResponse): AssistantTurnResponse {
  const requirements: TravelRequirements = response.requirements ?? {};
  return {
    ...response,
    requirements,
    missing: missingRequirements(requirements),
    ready: isReady(requirements),
  };
}

export interface AssistantApiError {
  message: string;
  retryable: boolean;
  rateLimited: boolean;
}

export function toAssistantError(error: unknown): AssistantApiError {
  const booking = toBookingError(error);
  return {
    message:
      booking.kind === "rate_limited"
        ? "You're sending messages a little too quickly. Please wait a moment and try again."
        : booking.message,
    retryable: booking.retryable,
    rateLimited: booking.kind === "rate_limited",
  };
}

export const assistantApi = {
  /** Which implementation is answering, for the UI badge. */
  mode: (): "demo" | "ai" => (useDemoAssistant ? "demo" : "ai"),

  async interpret(
    input: AssistantTurnRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<AssistantTurnResponse> {
    const payload: AssistantTurnRequest = {
      message: sanitizeAssistantMessage(input.message),
      requirements: input.requirements ?? {},
      history: trimHistory(input.history ?? []),
    };

    if (!payload.message) {
      throw new Error("Please type a message first.");
    }

    if (useDemoAssistant) {
      return harden(await demoProvider.interpret(payload));
    }

    const response = await bookingApi.post<AssistantTurnResponse>(
      "/api/v1/assistant/interpret",
      payload,
      { timeoutMs: 30_000, signal: options.signal },
    );
    return harden({ ...response, provider: "ai" });
  },
};
