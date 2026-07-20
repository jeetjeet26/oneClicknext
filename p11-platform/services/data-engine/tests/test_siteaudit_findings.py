"""Tests for finding fingerprints and the discovered/fixed lifecycle."""

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from siteaudit.findings import compute_fingerprint, sync_findings  # noqa: E402
from siteaudit.models import Finding  # noqa: E402
from siteaudit.crawler import is_safe_public_url, normalize_seed  # noqa: E402


def make_finding(detector: str = "title_missing", **overrides) -> Finding:
    defaults = dict(
        category="titles",
        detector=detector,
        severity="high",
        title="Missing title tags",
        description="Some pages have no title.",
        occurrences=3,
        affected_urls=["https://example.com/a", "https://example.com/b"],
    )
    defaults.update(overrides)
    return Finding(**defaults)


class TestFingerprint:
    def test_stable_across_runs(self):
        a = make_finding(occurrences=3)
        b = make_finding(occurrences=99, affected_urls=["https://example.com/z"])
        assert compute_fingerprint(a) == compute_fingerprint(b)

    def test_qualifier_changes_fingerprint(self):
        a = make_finding()
        b = make_finding(fingerprint_qualifier="group-2")
        assert compute_fingerprint(a) != compute_fingerprint(b)


class FakeQuery:
    """Minimal chainable stub of the supabase table query API."""

    def __init__(self, store: "FakeSupabase", table: str):
        self.store = store
        self.table = table
        self.operation: Optional[str] = None
        self.payload: Any = None
        self.filters: List[tuple] = []

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        rows = self.store.tables.setdefault(self.table, [])
        if self.operation == "select":
            data = [row for row in rows if all(row.get(col) == val for col, val in self.filters)]
            return type("R", (), {"data": data})()
        if self.operation == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            for payload in payloads:
                record = dict(payload)
                record.setdefault("id", f"row-{len(rows) + 1}")
                rows.append(record)
            return type("R", (), {"data": payloads})()
        if self.operation == "update":
            updated = []
            for row in rows:
                if all(row.get(col) == val for col, val in self.filters):
                    row.update(self.payload)
                    updated.append(row)
            return type("R", (), {"data": updated})()
        raise AssertionError("no operation set")


class FakeSupabase:
    def __init__(self):
        self.tables: Dict[str, List[Dict[str, Any]]] = {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)


class TestLifecycle:
    def test_new_findings_are_inserted_with_todo_status(self):
        supabase = FakeSupabase()
        result = sync_findings(supabase, "prop-1", "crawl-1", [make_finding()])
        assert result == {"new": 1, "updated": 0, "fixed": 0}
        rows = supabase.tables["geo_site_findings"]
        assert rows[0]["status"] == "todo"
        assert rows[0]["occurrences"] == 3
        assert rows[0]["first_detected_at"]

    def test_persisting_findings_are_updated_not_duplicated(self):
        supabase = FakeSupabase()
        sync_findings(supabase, "prop-1", "crawl-1", [make_finding(occurrences=3)])
        result = sync_findings(supabase, "prop-1", "crawl-2", [make_finding(occurrences=7)])
        assert result == {"new": 0, "updated": 1, "fixed": 0}
        rows = supabase.tables["geo_site_findings"]
        assert len(rows) == 1
        assert rows[0]["occurrences"] == 7
        assert rows[0]["source_crawl_id"] == "crawl-2"

    def test_absent_findings_are_marked_fixed(self):
        supabase = FakeSupabase()
        sync_findings(supabase, "prop-1", "crawl-1", [make_finding()])
        result = sync_findings(supabase, "prop-1", "crawl-2", [])
        assert result == {"new": 0, "updated": 0, "fixed": 1}
        rows = supabase.tables["geo_site_findings"]
        assert rows[0]["status"] == "fixed"
        assert rows[0]["fixed_at"]

    def test_reappearing_finding_is_reopened(self):
        supabase = FakeSupabase()
        sync_findings(supabase, "prop-1", "crawl-1", [make_finding()])
        sync_findings(supabase, "prop-1", "crawl-2", [])  # fixed
        result = sync_findings(supabase, "prop-1", "crawl-3", [make_finding()])
        assert result == {"new": 0, "updated": 1, "fixed": 0}
        rows = supabase.tables["geo_site_findings"]
        assert rows[0]["status"] == "todo"
        assert rows[0]["fixed_at"] is None

    def test_wont_fix_is_never_auto_fixed(self):
        supabase = FakeSupabase()
        sync_findings(supabase, "prop-1", "crawl-1", [make_finding()])
        supabase.tables["geo_site_findings"][0]["status"] = "wont_fix"
        result = sync_findings(supabase, "prop-1", "crawl-2", [])
        assert result == {"new": 0, "updated": 0, "fixed": 0}
        assert supabase.tables["geo_site_findings"][0]["status"] == "wont_fix"


class TestCrawlerSafety:
    def test_normalize_seed(self):
        assert normalize_seed("example.com") == "https://example.com"
        assert normalize_seed("https://example.com/path?q=1#frag") == "https://example.com/path"
        assert normalize_seed("") is None

    def test_rejects_private_hosts(self):
        assert normalize_seed("http://localhost:3000") is None
        assert normalize_seed("http://192.168.1.1") is None
        assert normalize_seed("http://10.0.0.5/admin") is None
        assert is_safe_public_url("https://example.com/") is True
        assert is_safe_public_url("ftp://example.com/") is False
