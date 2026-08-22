from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers.get("X-Request-ID")


def test_readiness():
    res = client.get("/health/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert body["checks"]["app"] is True


def test_unknown_route_is_structured():
    res = client.get("/does-not-exist")
    assert res.status_code == 404
    body = res.json()
    assert body["success"] is False
    assert body["code"] == "NOT_FOUND"


def test_no_wildcard_cors():
    from app.core.config import get_settings

    assert "*" not in get_settings().cors_allowed_origins
