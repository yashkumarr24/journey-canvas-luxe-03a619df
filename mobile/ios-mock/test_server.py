"""Isolated local HTTP and mocked Browser tests; no real payment services."""
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ios_mock_server", ROOT / "server.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Mock server unavailable")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class MockAttemptTests(unittest.TestCase):
    def setUp(self):
        SERVER.STATE["tokens"].clear()
        SERVER.STATE["status"].clear()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.H)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, fields=None):
        data = urlencode(fields).encode() if fields is not None else None
        request = Request(self.origin + path, data=data)
        try:
            with urlopen(request) as response:
                return response.status, response.read().decode()
        except HTTPError as error:
            return error.code, error.read().decode()

    def order(self, query=""):
        code, body = self.request("/mock/order" + query)
        self.assertEqual(code, 200)
        return json.loads(body)

    def status(self, ref):
        code, body = self.request("/mock/status?" + urlencode({"ref": ref}))
        self.assertEqual(code, 200)
        return json.loads(body)["status"]

    def test_new_attempt_starts_awaiting_payment(self):
        order = self.order()
        self.assertRegex(order["bookingReference"], r"^FNFH[0-9A-F]{6}$")
        self.assertEqual(self.status(order["bookingReference"]), "awaiting_payment")

    def assert_fresh_after(self, outcome, expected):
        old = self.order()["bookingReference"]
        code, _ = self.request("/mock-result", {"txnid": old, "r": outcome})
        self.assertEqual(code, 200)
        self.assertEqual(self.status(old), expected)
        fresh = self.order("?" + urlencode({"ref": old}))["bookingReference"]
        self.assertNotEqual(fresh, old)
        self.assertEqual(self.status(fresh), "awaiting_payment")
        self.assertEqual(self.status(old), expected)

    def test_success_not_inherited_by_fresh_attempt(self):
        self.assert_fresh_after("success", "confirmed")

    def test_failure_not_inherited_by_fresh_attempt(self):
        self.assert_fresh_after("failure", "payment_failed")

    def test_reference_collision_does_not_reuse_attempt(self):
        with patch.object(SERVER.secrets, "token_hex", side_effect=["abcdef", "abcdef", "123456"]):
            first = self.order()["bookingReference"]
            second = self.order()["bookingReference"]
        self.assertNotEqual(first, second)
        self.assertEqual(self.status(first), "awaiting_payment")
        self.assertEqual(self.status(second), "awaiting_payment")

    def test_invalid_outcomes_rejected_without_status_change(self):
        for existing in ("awaiting_payment", "confirmed", "payment_failed"):
            ref = self.order()["bookingReference"]
            SERVER.STATE["status"][ref] = existing
            for outcome in (None, "", "pending", "SUCCESS", " failure", ["success", "failure"]):
                with self.subTest(existing=existing, outcome=outcome):
                    fields = [("txnid", ref)]
                    if isinstance(outcome, list):
                        fields.extend(("r", value) for value in outcome)
                    elif outcome is not None:
                        fields.append(("r", outcome))
                    code, _ = self.request("/mock-result", fields)
                    self.assertEqual(code, 400)
                    self.assertEqual(self.status(ref), existing)

    def test_unknown_reference_cannot_create_result(self):
        code, _ = self.request("/mock-result", {"txnid": "FNFH000000", "r": "success"})
        self.assertEqual(code, 404)
        self.assertEqual(self.status("FNFH000000"), "unknown")

    def test_browser_dismissal_leaves_attempt_pending(self):
        from playwright.sync_api import sync_playwright, expect

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 1800})
            # Only local mock traffic is allowed, including the simulated sheet.
            def route(request_route):
                if request_route.request.url == self.origin + "/app":
                    request_route.fulfill(body=(ROOT / "www/index.html").read_text(), content_type="text/html")
                elif request_route.request.url.startswith(self.origin + "/"):
                    request_route.continue_()
                else:
                    request_route.abort()
            context.route("**/*", route)
            page = context.new_page()
            page.add_init_script("""
                window.mockListeners = {};
                window.Capacitor = {Plugins: {Browser: {
                    open: async function(options) { window.mockSheetUrl = options.url; },
                    addListener: function(event, handler) { window.mockListeners[event] = handler; }
                }}};
            """)
            page.goto(self.origin + "/app")
            page.get_by_role("textbox", name="Mac mock server").fill(self.origin)
            page.get_by_role("button", name="Pay (mock)", exact=True).click()
            expect(page.locator("#log")).to_contain_text("opening Safari sheet")
            sheet_url = page.evaluate("window.mockSheetUrl")
            ref = page.evaluate("JSON.parse(localStorage.getItem('fnf:ios-payu:recovery')).ref")
            sheet = context.new_page()
            sheet.goto(sheet_url)
            expect(sheet.get_by_role("button", name="Simulate success")).to_be_visible()
            expect(sheet.get_by_text("MOCK-SIGNATURE", exact=True)).to_be_visible()
            self.assertEqual(self.status(ref), "awaiting_payment")
            sheet.close()  # No outcome selected; emulate native dismissal notification.
            page.evaluate("window.mockListeners.browserFinished()")
            expect(page.locator("#status")).to_have_text(ref + ": awaiting_payment")
            self.assertEqual(self.status(ref), "awaiting_payment")
            self.assertIsNotNone(page.evaluate("localStorage.getItem('fnf:ios-payu:recovery')"))
            self.assertNotIn("recovery cleared", page.locator("#log").inner_text())
            browser.close()


if __name__ == "__main__":
    unittest.main()