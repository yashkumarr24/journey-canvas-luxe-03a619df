"""TripJack provider adapter.

Isolation boundary: everything TripJack-specific (HTTP, auth header, wire
schema, error codes) lives in this package. The rest of the application only
sees our normalized flight models, so swapping or adding a provider later
does not touch route handlers, services or the frontend.
"""

from app.integrations.tripjack.config import TripJackConfig, build_config

__all__ = ["TripJackConfig", "build_config"]
