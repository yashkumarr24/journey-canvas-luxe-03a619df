"""OpenAI provider skeleton for the travel assistant (PHASE 12).

INTENTIONALLY NOT ACTIVE. No credentials exist yet, so this class documents the
exact call shape and — most importantly — the safety rules that must hold when it
is switched on:

  * The API key is read from settings (OPENAI_API_KEY), which is a BACKEND-ONLY
    environment variable. It is never logged and never returned to a caller.
  * The model is asked for STRUCTURED REQUIREMENTS ONLY. Its output is parsed
    into `TravelRequirements`, which has no field for a fare, fare id, price,
    schedule, availability or baggage rule, so model text can never reach the
    provider adapter or the customer as if it were flight data.
  * Anything that fails schema validation is discarded; the service then asks the
    customer instead of guessing.
  * The model never receives payment data, passport/document numbers or OTPs, and
    it is never given the ability to call an external API.

To activate: set OPENAI_API_KEY and ASSISTANT_PROVIDER=openai, implement the
`_call_model` body against the chosen model, and keep `_STRUCTURE_INSTRUCTIONS`
as the system prompt contract.
"""

from __future__ import annotations

import json

from app.core.config import Settings
from app.core.logging import get_logger
from app.schemas.assistant import AssistantTurnRequest, TravelRequirements

from .base import AssistantInterpretation, AssistantProvider, AssistantUnavailableError

logger = get_logger(__name__)

_STRUCTURE_INSTRUCTIONS = """
You are a flight travel assistant for an online travel agency.
Extract ONLY structured search requirements from the conversation and return a
single JSON object with these optional keys:
tripType (oneway|roundtrip), origin (IATA), originLabel, destination (IATA),
destinationLabel, departureDate (YYYY-MM-DD), returnDate (YYYY-MM-DD),
durationNights, adults, children, infants,
cabinClass (economy|premium_economy|business|first),
preferredDepartureWindow / preferredArrivalWindow
(early_morning|morning|afternoon|evening|night), nonStopOnly (bool),
baggagePreference (checked_baggage|cabin_only), preferredAirlines (list),
notes (list).
Never invent flights, fares, prices, fare ids, timings, seat availability or
baggage allowances. If a required detail is missing, leave it out.
""".strip()


class OpenAIAssistantProvider(AssistantProvider):
    id = "ai"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        if not settings.openai_api_key:
            raise AssistantUnavailableError("The travel assistant is not configured yet.")

    async def _call_model(self, request: AssistantTurnRequest) -> str:
        """Return the model's raw JSON string. Implemented when credentials land."""
        raise AssistantUnavailableError("The travel assistant is not configured yet.")

    async def interpret(self, request: AssistantTurnRequest) -> AssistantInterpretation:
        raw = await self._call_model(request)
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("expected an object")
            # Merge onto what we already understood, then validate. Invalid or
            # hallucinated fields are dropped by the schema.
            merged = request.requirements.model_dump(by_alias=True)
            merged.update({k: v for k, v in payload.items() if v is not None})
            requirements = TravelRequirements.model_validate(merged)
        except Exception:  # noqa: BLE001 - never surface model internals
            logger.warning("assistant_model_output_rejected")
            # Keep the previous understanding rather than trusting bad output.
            requirements = request.requirements

        return AssistantInterpretation(reply="", requirements=requirements, understood=[])
