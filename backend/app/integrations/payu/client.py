"""PayU India Hosted Checkout + General (postservice) APIs.

Docs:
- Collect Payment (_payment): https://docs.payu.in/reference/_payment_payu_hosted_checkout
- Hashing request/response:   https://docs.payu.in/docs/hashing-request-and-response
- Verify Payment:             https://docs.payu.in/reference/verify_payment_api
- Refund (cancel_refund_transaction) / check_action_status: General APIs,
  hash sha512(key|command|var1|salt).

The merchant SALT never leaves this module's callers on the backend. Nothing
here logs hashes, salts or full provider payloads.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Mapping, Optional

import httpx

HOSTS = {
    "test": {"pay": "https://test.payu.in/_payment", "api": "https://test.payu.in/merchant/postservice?form=2"},
    "production": {"pay": "https://secure.payu.in/_payment", "api": "https://info.payu.in/merchant/postservice?form=2"},
}

UDF_KEYS = ("udf1", "udf2", "udf3", "udf4", "udf5")


class PayUError(RuntimeError):
    """PayU unreachable or returned an unusable answer."""


def format_amount(value: Any) -> str:
    """PayU amounts are decimal strings with exactly two places."""
    return str(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _sha512(raw: str) -> str:
    return hashlib.sha512(raw.encode("utf-8")).hexdigest()


def request_hash(key: str, salt: str, f: Mapping[str, str]) -> str:
    """sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT)"""
    parts = [key, f["txnid"], f["amount"], f["productinfo"], f["firstname"], f["email"]]
    parts += [f.get(k, "") for k in UDF_KEYS]
    parts += [""] * 5 + [salt]
    return _sha512("|".join(parts))


def response_hash(key: str, salt: str, f: Mapping[str, str]) -> str:
    """Reverse hash:
    [additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    """
    parts = [salt, f.get("status", "")] + [""] * 5
    parts += [f.get(k, "") for k in reversed(UDF_KEYS)]
    parts += [f.get("email", ""), f.get("firstname", ""), f.get("productinfo", ""),
              f.get("amount", ""), f.get("txnid", ""), key]
    raw = "|".join(parts)
    extra = f.get("additionalCharges") or f.get("additional_charges")
    if extra:
        raw = f"{extra}|{raw}"
    return _sha512(raw)


def response_hash_valid(key: str, salt: str, f: Mapping[str, str]) -> bool:
    supplied = (f.get("hash") or "").lower()
    if not supplied:
        return False
    return hmac.compare_digest(supplied, response_hash(key, salt, f))


def command_hash(key: str, command: str, var1: str, salt: str) -> str:
    return _sha512(f"{key}|{command}|{var1}|{salt}")


@dataclass(frozen=True)
class VerifiedTxn:
    txnid: str
    status: str            # "success" | "failure" | "pending" | other PayU value
    amount: Optional[str]  # as reported by PayU, 2dp
    mihpayid: Optional[str]


class PayUClient:
    def __init__(self, *, key: str, salt: str, env: str, timeout: float = 15.0,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        if env not in HOSTS:
            raise ValueError("unknown_payu_env")
        self.key, self._salt, self.env = key, salt, env
        self._timeout, self._transport = timeout, transport

    @property
    def payment_url(self) -> str:
        return HOSTS[self.env]["pay"]

    def sign(self, fields: Mapping[str, str]) -> str:
        return request_hash(self.key, self._salt, fields)

    def verify_response(self, fields: Mapping[str, str]) -> bool:
        return response_hash_valid(self.key, self._salt, fields)

    async def _command(self, command: str, var1: str, **extra: str) -> dict[str, Any]:
        data = {"key": self.key, "command": command, "var1": var1,
                "hash": command_hash(self.key, command, var1, self._salt), **extra}
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as c:
                r = await c.post(HOSTS[self.env]["api"], data=data)
        except httpx.HTTPError as exc:
            raise PayUError("payu_unreachable") from exc
        if r.status_code >= 300:
            raise PayUError(f"payu_http_{r.status_code}")
        try:
            body = r.json()
        except ValueError as exc:
            raise PayUError("payu_bad_json") from exc
        if not isinstance(body, dict):
            raise PayUError("payu_bad_shape")
        return body

    async def verify_payment(self, txnid: str) -> VerifiedTxn:
        body = await self._command("verify_payment", txnid)
        details = (body.get("transaction_details") or {}).get(txnid) or {}
        if not isinstance(details, dict):
            details = {}
        amt = details.get("amt") or details.get("transaction_amount")
        return VerifiedTxn(
            txnid=txnid,
            status=str(details.get("status") or "not_found").lower(),
            amount=format_amount(amt) if amt not in (None, "") else None,
            mihpayid=str(details["mihpayid"]) if details.get("mihpayid") else None,
        )

    async def refund(self, mihpayid: str, token: str, amount: str) -> dict[str, Any]:
        """cancel_refund_transaction: var1=mihpayid, var2=unique token, var3=amount."""
        return await self._command("cancel_refund_transaction", mihpayid, var2=token, var3=amount)

    async def refund_status(self, request_id: str) -> dict[str, Any]:
        return await self._command("check_action_status", request_id)
