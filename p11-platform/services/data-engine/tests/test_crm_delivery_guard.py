import asyncio
import os
import unittest
from unittest.mock import patch
from fastapi import BackgroundTasks, HTTPException
from routers.crm_integration import (
    PushLeadRequest, AddLeadNoteRequest, ValidateMappingRequest, BulkSyncRequest,
    push_lead, add_lead_note, validate_mapping, bulk_sync_leads,
)
from utils.delivery_guard import require_delivery_enabled


class CRMDeliveryGuardTest(unittest.TestCase):
    def test_default_is_paused_and_only_explicit_false_releases_delivery(self):
        for value in [None, "", "true", "0", "off", "unexpected"]:
            with patch.dict(os.environ, {}, clear=True):
                if value is not None:
                    os.environ["OUTBOUND_DELIVERY_PAUSED"] = value
                with self.assertRaises(HTTPException) as blocked:
                    require_delivery_enabled()
                self.assertEqual(blocked.exception.status_code, 423)
        with patch.dict(os.environ, {"OUTBOUND_DELIVERY_PAUSED": " FALSE "}):
            require_delivery_enabled()

    def test_each_provider_write_path_stops_before_credentials_or_network(self):
        common = dict(property_id="fixture", crm_type="lasso", credentials={"api_key": "fixture-only"})
        cases = [
            (push_lead, PushLeadRequest(**common, lead_id="lead", lead_data={}, field_mapping={})),
            (add_lead_note, AddLeadNoteRequest(**common, lead_id="lead", external_id="external", note="fixture")),
            (validate_mapping, ValidateMappingRequest(**common, field_mapping={})),
            (bulk_sync_leads, BulkSyncRequest(property_id="fixture", lead_ids=["lead"])),
        ]
        with patch.dict(os.environ, {"OUTBOUND_DELIVERY_PAUSED": "true"}), patch("routers.crm_integration.get_crm_adapter") as adapter, patch("routers.crm_integration.get_supabase_client") as database:
            for fn, request in cases:
                with self.assertRaises(HTTPException) as blocked:
                    if fn is bulk_sync_leads:
                        asyncio.run(fn(request, BackgroundTasks(), api_key="fixture"))
                    else:
                        asyncio.run(fn(request, api_key="fixture"))
                self.assertEqual(blocked.exception.status_code, 423)
            adapter.assert_not_called()
            database.assert_not_called()
