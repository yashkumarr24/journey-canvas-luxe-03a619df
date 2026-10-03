"""Possible-duplicate detection. Flags only; never merges.

Rule (approved): a pair is a candidate when the package codes match, or the
normalised names match. 'destination' is added as a reason when both are in
the same destination. Same destination alone is NOT a candidate (too noisy).
"""

from __future__ import annotations

import re
from typing import Any, Iterable


def norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def candidate_reasons(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if a.get("package_code") and norm(a["package_code"]) == norm(b.get("package_code")):
        reasons.append("package_code")
    if a.get("name") and norm(a["name"]) == norm(b.get("name")):
        reasons.append("name")
    if reasons and a.get("destination_key") and a.get("destination_key") == b.get("destination_key"):
        reasons.append("destination")
    return reasons


def find_candidates(items: Iterable[dict[str, Any]]) -> list[tuple[str, str, list[str]]]:
    rows = list(items)
    out: list[tuple[str, str, list[str]]] = []
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if a["key"] == b["key"]:
                continue
            reasons = candidate_reasons(a, b)
            if reasons:
                x, y = sorted([a["key"], b["key"]])
                out.append((x, y, reasons))
    return out
