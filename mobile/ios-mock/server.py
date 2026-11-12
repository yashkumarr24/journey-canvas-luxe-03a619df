#!/usr/bin/env python3
"""MOCK PayU handoff server for a physical-iPhone demo. Runs on your Mac only.
No PayU, TripJack, Supabase or production API is ever contacted. Every page
says MOCK. Usage: python3 mobile/ios-mock/server.py  (port 8787)"""
import html, json, secrets, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import parse_qs, urlparse

STATE = {"tokens": {}, "status": {}}  # token -> (ref, expiry, used); ref -> status
ATTEMPT_LOCK = Lock()

def page(title, body):
    return f"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>{title}</title><body style="font:18px -apple-system;padding:24px;max-width:520px;margin:auto">
<p style="background:#fde68a;padding:8px;border-radius:6px"><b>MOCK — no real payment</b></p>{body}</body>"""

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers(); self.wfile.write(data)

    def do_OPTIONS(self): self._send(204, "")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/mock/order":          # app asks for a handoff link
            # Every click is a separate mock attempt, never a reused result.
            with ATTEMPT_LOCK:
                ref = "FNFH" + secrets.token_hex(3).upper()
                while ref in STATE["status"]:
                    ref = "FNFH" + secrets.token_hex(3).upper()
                tok = secrets.token_urlsafe(32)
                STATE["tokens"][tok] = [ref, time.time() + 120, False]
                STATE["status"][ref] = "awaiting_payment"
            host = self.headers["Host"]
            return self._send(200, json.dumps({"bookingReference": ref,
                "handoffUrl": f"http://{host}/handoff#token={tok}"}), "application/json")
        if u.path == "/handoff":             # fragment-only token, stripped then POSTed
            return self._send(200, page("Mock handoff", """<p>Opening mock payment…</p>
<form id=f method=post action=/handoff/redeem><input type=hidden name=token id=t></form>
<script>var m=location.hash.match(/^#token=([A-Za-z0-9_-]{43})$/);
history.replaceState(null,'',location.pathname);
if(m){document.getElementById('t').value=m[1];document.getElementById('f').submit();}
else document.body.insertAdjacentHTML('beforeend','<p>Link missing or used.</p>');</script>"""))
        if u.path == "/mock/status":
            ref = parse_qs(u.query).get("ref", [""])[0]
            return self._send(200, json.dumps({"reference": ref,
                "status": STATE["status"].get(ref, "unknown")}), "application/json")
        self._send(404, page("Not found", "<p>Not found</p>"))

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        values = parse_qs(self.rfile.read(n).decode(), keep_blank_values=True)
        form = {k: v[0] for k, v in values.items()}
        u = urlparse(self.path)
        if u.path == "/handoff/redeem":      # burn once, return auto-POST "signed" form
            rec = STATE["tokens"].get(form.get("token", ""))
            if not rec or rec[2] or rec[1] < time.time():
                return self._send(410, page("Expired", "<p>This payment link has expired or was used. Return to the app.</p>"))
            rec[2] = True
            ref = html.escape(rec[0])
            return self._send(200, page("Mock PayU", f"""<form id=f method=post action=/mock-payu>
<input type=hidden name=txnid value="{ref}"><input type=hidden name=amount value="1.00">
<input type=hidden name=hash value="MOCK-SIGNATURE"></form><script>document.getElementById('f').submit()</script>"""))
        if u.path == "/mock-payu":           # simulated gateway checkout
            ref = html.escape(form.get("txnid", ""))
            return self._send(200, page("Mock gateway", f"""<p>Booking <b>{ref}</b>, amount ₹{html.escape(form.get('amount',''))}</p>
<p>Signed field received: <code>{html.escape(form.get('hash',''))}</code></p>
<form method=post action=/mock-result><input type=hidden name=txnid value="{ref}">
<button name=r value=success style="font-size:20px;padding:12px;width:100%">Simulate success</button><p></p>
<button name=r value=failure style="font-size:20px;padding:12px;width:100%">Simulate failure</button></form>"""))
        if u.path == "/mock-result":
            ref = form.get("txnid", "")
            if values.get("r") not in (["success"], ["failure"]):
                return self._send(400, page("Invalid outcome", "<p>Select an explicit mock success or failure. Status was not changed.</p>"))
            if ref not in STATE["status"]:
                return self._send(404, page("Unknown attempt", "<p>Mock attempt not found. Status was not changed.</p>"))
            ok = form["r"] == "success"
            STATE["status"][ref] = "confirmed" if ok else "payment_failed"
            return self._send(200, page("Done", f"<h2>Mock payment {'successful' if ok else 'failed'}</h2><p>Tap <b>Done</b> (top-left) to return to the app.</p>"))
        self._send(404, "")

    def log_message(self, f, *a): print("[mock]", self.command, self.path.split("#")[0])

if __name__ == "__main__":
    print("MOCK server on :8787 — no external calls are made.")
    ThreadingHTTPServer(("0.0.0.0", 8787), H).serve_forever()
