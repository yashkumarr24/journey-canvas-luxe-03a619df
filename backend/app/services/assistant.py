"""Travel assistant service (PHASE 12).

Owns the parts that must NOT live in a provider:
  * gap detection ("what still needs asking"),
  * readiness (do the requirements form a valid flight search?),
  * the reply wording,
  * final validation of provider output.

It deliberately does not search for flights. The frontend takes the validated
requirements to the existing flight-search boundary, which is the only path to a
provider, a fare or a price.
"""

from __future__ import annotations

from datetime import date

from app.core.config import Settings
from app.core.logging import get_logger
from app.integrations.ai import get_assistant_provider
from app.integrations.ai.base import AssistantUnavailableError
from app.schemas.assistant import (
    MAX_PASSENGERS,
    AssistantTurnRequest,
    AssistantTurnResponse,
    MissingRequirement,
    TravelRequirements,
)

logger = get_logger(__name__)

PROMPTS = {
    "origin": "Which city will you be departing from?",
    "destination": "Where would you like to fly to?",
    "departureDate": "What date would you like to travel?",
    "returnDate": "When would you like to return?",
    "passengers": "How many travellers are flying, and are any of them children or infants?",
    "cabinClass": "Which cabin would you prefer — economy, premium economy, business or first?",
}

SUGGESTIONS_WHEN_READY = [
    "Only non-stop flights",
    "Prefer a morning departure",
    "Make it business class",
]


def missing_requirements(requirements: TravelRequirements) -> list[MissingRequirement]:
    missing: list[MissingRequirement] = []
    if not requirements.origin:
        missing.append(MissingRequirement(field="origin", prompt=PROMPTS["origin"]))
    if not requirements.destination:
        missing.append(MissingRequirement(field="destination", prompt=PROMPTS["destination"]))
    if not requirements.departure_date:
        missing.append(MissingRequirement(field="departureDate", prompt=PROMPTS["departureDate"]))
    if requirements.trip_type == "roundtrip" and not requirements.return_date:
        missing.append(MissingRequirement(field="returnDate", prompt=PROMPTS["returnDate"]))
    return missing


def validation_issues(requirements: TravelRequirements) -> list[str]:
    """Problems that block a search even though nothing is missing."""
    issues: list[str] = []
    today = date.today()
    if requirements.departure_date and requirements.departure_date < today:
        issues.append("The departure date is in the past. Please give a future date.")
    if requirements.origin and requirements.origin == requirements.destination:
        issues.append("Origin and destination must be different.")
    adults = requirements.adults or 1
    if (requirements.infants or 0) > adults:
        issues.append("Each infant must be accompanied by an adult.")
    if adults + (requirements.children or 0) > MAX_PASSENGERS:
        issues.append(f"A single booking can hold up to {MAX_PASSENGERS} travellers.")
    return issues


def _reply(understood: list[str], missing: list[MissingRequirement], issues: list[str]) -> str:
    heard = f"Got it — I noted {', '.join(understood[:4])}." if understood else "Noted."
    if not understood and missing:
        return f"I couldn't pick out travel details from that. {missing[0].prompt}"
    if missing:
        return f"{heard} {missing[0].prompt}"
    if issues:
        return f"{heard} One thing to fix first: {' '.join(issues)}"
    return (
        f"{heard} I have everything I need — check the summary and I'll run a live "
        "flight search for you."
    )


class AssistantService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def interpret(self, request: AssistantTurnRequest) -> AssistantTurnResponse:
        provider = get_assistant_provider(self._settings)
        try:
            interpretation = await provider.interpret(request)
        except AssistantUnavailableError:
            raise
        except Exception:  # noqa: BLE001 - never leak provider internals
            logger.warning("assistant_provider_failed", extra={"provider": provider.id})
            raise AssistantUnavailableError()

        # Final gate: whatever a provider returned is re-validated here.
        requirements = TravelRequirements.model_validate(
            interpretation.requirements.model_dump(by_alias=True)
        )
        missing = missing_requirements(requirements)
        issues = validation_issues(requirements)
        ready = not missing and not issues

        return AssistantTurnResponse(
            reply=interpretation.reply or _reply(interpretation.understood, missing, issues),
            requirements=requirements,
            missing=missing,
            ready=ready,
            suggestions=interpretation.suggestions or (SUGGESTIONS_WHEN_READY if ready else []),
            provider="ai" if provider.id == "ai" else "demo",
        )
