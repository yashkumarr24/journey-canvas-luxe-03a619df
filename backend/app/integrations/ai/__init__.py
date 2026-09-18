"""Pluggable AI providers for the travel assistant (PHASE 12).

`get_assistant_provider()` returns the demo provider until an OpenAI API key is
configured. The key is read from settings (backend-only) and never returned to a
caller. Swapping providers requires no change in the API layer or the frontend.
"""

from __future__ import annotations

from app.core.config import Settings

from .base import AssistantProvider
from .demo_provider import DemoAssistantProvider
from .openai_provider import OpenAIAssistantProvider

__all__ = [
    "AssistantProvider",
    "DemoAssistantProvider",
    "OpenAIAssistantProvider",
    "get_assistant_provider",
]


def get_assistant_provider(settings: Settings) -> AssistantProvider:
    if settings.openai_api_key and settings.assistant_provider.lower() == "openai":
        return OpenAIAssistantProvider(settings)
    return DemoAssistantProvider()
