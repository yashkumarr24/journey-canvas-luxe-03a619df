"""Offline SQL parsing and mocked contract tests; never connect to PostgreSQL."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = ROOT / "db/candidates/ios-payu"
SQL = (CANDIDATE / "0035_payu_handoffs.PROPOSAL.sql").read_text()
PREFLIGHT = (CANDIDATE / "DB_PREFLIGHT.sql").read_text()


def currency_metadata_accepted(oid, typmod, not_null):
    """Mock of the explicit catalog assertion, not a database emulator."""
    return oid == "bpchar" and typmod == 7 and not_null is True


@pytest.mark.parametrize("oid,width,required,expected", [
    ("bpchar", 7, True, True), ("text", -1, True, False),
    ("bpchar", 5, True, False), ("bpchar", 8, True, False),
    ("bpchar", 7, False, False), (None, None, None, False),
])
def test_currency_requires_character_three(oid, width, required, expected):
    assert currency_metadata_accepted(oid, width, required) is expected
    assert "atttypid='pg_catalog.bpchar'::regtype AND atttypmod=7 AND attnotnull" in PREFLIGHT


def test_currency_matches_original_migration():
    baseline = (ROOT / "db/migrations/0005_payments_events.sql").read_text()
    assert re.search(r"currency\s+char\(3\) not null", baseline)
    assert "currency ~ '^[A-Z]{3}$'" in baseline
    assert "ALTER TABLE public.payments" not in SQL


@pytest.mark.parametrize("filename", ["DB_PREFLIGHT.sql", "0035_payu_handoffs.PROPOSAL.sql"])
def test_postgresql_parser_without_execution(filename):
    from pglast import parse_plpgsql, parse_sql
    text = (CANDIDATE / filename).read_text()
    assert parse_sql(text)
    assert parse_plpgsql(text)


def test_preflight_same_before_ddl():
    block = PREFLIGHT[PREFLIGHT.index("DO $$"):PREFLIGHT.index("-- Definitions/ACLs")]
    assert block in SQL[:SQL.index("CREATE TABLE")]
    assert "BEGIN READ ONLY;" in PREFLIGHT and "ROLLBACK;" in PREFLIGHT


def test_grant_and_invoker_access():
    table_end = SQL.index("\n);", SQL.index("CREATE TABLE")) + 4
    assert SQL[table_end:].lstrip().startswith("GRANT SELECT, INSERT, UPDATE")
    assert "SECURITY DEFINER" not in SQL
    assert SQL.count("SECURITY INVOKER") == 3
    assert SQL.count("SET search_path = pg_catalog, pg_temp") == 3
    assert "ALTER TABLE public.payu_handoffs ENABLE ROW LEVEL SECURITY" in SQL
    assert "rolbypassrls" in SQL


def test_nulls_and_locked_expiry_refuse():
    assert "p_expires_at IS NULL" in SQL and "NOT isfinite(p_expires_at)" in SQL
    assert "p.amount IS NULL OR b.total_amount IS NULL" in SQL
    assert "p.currency::text IS DISTINCT FROM 'INR'" in SQL
    consume = SQL[SQL.index("CREATE FUNCTION public.payu_consume_handoff"):]
    assert consume.index("FOR UPDATE;") < consume.index("checked_at := clock_timestamp()")
    assert "IF NOT FOUND THEN RETURN; END IF;\n  checked_at" in consume
    assert consume.index("SET consumed_at=checked_at") < consume.index("p.provider::text IS DISTINCT")


def test_initial_issue_and_delivered_form_replacements_refuse():
    assert "IF n=0 OR n>=3 THEN RETURN" in SQL
    assert "x.payment_id=p.id AND x.consumed_at IS NOT NULL" in SQL
    assert "h.expires_at > checked_at" in SQL
    assert "interval '10 seconds'" in SQL
    assert "public.payment_fulfilment_jobs" in SQL
    assert "b.provider_booking_id IS NOT NULL" in SQL


def test_mutators_share_lock_order():
    for name in ("payu_issue_handoff", "payu_consume_handoff"):
        body = SQL[SQL.index("CREATE FUNCTION public." + name):].split("END $$;")[0]
        assert body.index("FROM public.payments WHERE") < body.index("FROM public.hotel_bookings WHERE")
        token_lock = body.rindex("FOR UPDATE;")
        assert body.index("FROM public.hotel_bookings WHERE") < token_lock


@pytest.mark.parametrize("links,consumed,expired,age,verified,expected", [
    (0, False, True, 20, "not_found", False),
    (1, False, True, 20, "not_found", True),
    (2, False, True, 20, "not_found", True),
    (3, False, True, 20, "not_found", False),
    (1, True, True, 20, "not_found", False),
    (1, False, False, 20, "not_found", False),
    (1, False, True, 2, "not_found", False),
    (1, False, True, 20, "pending", False),
    (1, False, True, 20, None, False),
])
def test_mocked_replacement_policy(links, consumed, expired, age, verified, expected):
    # Conservative policy model; real lock/transaction execution remains untested.
    allowed = 0 < links < 3 and not consumed and expired and age >= 10 and verified == "not_found"
    assert allowed is expected
