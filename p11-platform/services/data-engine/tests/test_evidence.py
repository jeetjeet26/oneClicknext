"""Tests for evidence lineage helpers (utils/evidence.py)."""

from unittest.mock import MagicMock

from utils.evidence import content_hash_for, record_source_capture


class TestContentHashFor:
    def test_none_returns_none(self):
        assert content_hash_for(None) is None

    def test_string_is_stable(self):
        assert content_hash_for("abc") == content_hash_for("abc")
        assert content_hash_for("abc") != content_hash_for("abd")

    def test_non_string_is_hashed_via_repr(self):
        assert content_hash_for([1, 2, 3]) == content_hash_for([1, 2, 3])
        assert content_hash_for([1, 2, 3]) != content_hash_for([1, 2, 4])


def _mock_supabase(insert_result_data):
    supabase = MagicMock()
    execute_result = MagicMock()
    execute_result.data = insert_result_data
    supabase.table.return_value.insert.return_value.execute.return_value = execute_result
    return supabase


class TestRecordSourceCapture:
    def test_records_capture_and_returns_id(self):
        supabase = _mock_supabase([{"id": "capture-1"}])

        capture_id = record_source_capture(
            supabase,
            property_id="property-1",
            competitor_id="competitor-1",
            source_type="website",
            source_url="https://example.com",
            content_hash="hash-1",
        )

        assert capture_id == "capture-1"
        supabase.table.assert_called_once_with("market_source_captures")
        inserted = supabase.table.return_value.insert.call_args[0][0]
        assert inserted["property_id"] == "property-1"
        assert inserted["competitor_id"] == "competitor-1"
        assert inserted["source_type"] == "website"
        assert inserted["source_url"] == "https://example.com"
        assert inserted["content_hash"] == "hash-1"
        assert inserted["status"] == "captured"

    def test_unknown_source_type_normalized_to_other(self):
        supabase = _mock_supabase([{"id": "capture-2"}])

        record_source_capture(
            supabase,
            property_id="property-1",
            source_type="zillow-experimental",
        )

        inserted = supabase.table.return_value.insert.call_args[0][0]
        assert inserted["source_type"] == "other"

    def test_insert_failure_returns_none_without_raising(self):
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.side_effect = RuntimeError(
            "db down"
        )

        capture_id = record_source_capture(
            supabase,
            property_id="property-1",
            source_type="website",
        )

        assert capture_id is None
