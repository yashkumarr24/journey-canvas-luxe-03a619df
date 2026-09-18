"""Provider interface for the travel assistant."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas.assistant import AssistantTurnRequest, TravelRequirements


class AssistantUnavailableError(RuntimeError):
    """Raised when the configured provider cannot answer right now."""

    def __init__(self, message: str = "The travel assistant is temporarily unavailable.") -> None:
        super().__init__(message)
        self.message = message


class AssistantInterpretation:
    """A provider's raw understanding of one turn.

    Only `requirements` and a reply are carried. Providers cannot return
    flights, fares or availability — the type has nowhere to put them.
    """

    def __init__(
        self,
        *,
        reply: str,
        requirements: TravelRequirements,
        understood: list[str] | None = None,
        suggestions: list[str] | None = None,
    ) -> None:
        self.reply = reply
        self.requirements = requirements
        self.understood = understood or []
        self.suggestions = suggestions or []


class AssistantProvider(ABC):
    """Implementations: DemoAssistantProvider now, OpenAIAssistantProvider later."""

    id: str = "demo"

    @abstractmethod
    async def interpret(self, request: AssistantTurnRequest) -> AssistantInterpretation:
        """Merge the new message into the requirements understood so far."""
        raise NotImplementedError
