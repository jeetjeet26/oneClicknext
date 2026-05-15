import asyncio
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from connectors.crm_adapters.lasso_adapter import LassoAdapter, _compact_lasso_token
from routers.crm_integration import SaveMappingRequest, ValidateMappingRequest, get_crm_adapter, save_mapping, validate_mapping


def mock_response(status_code=200, payload=None, text=""):
    response = Mock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = payload if payload is not None else {}
    return response


class LassoAdapterTest(unittest.TestCase):
    def test_requires_api_key(self):
        with self.assertRaisesRegex(ValueError, "api_key"):
            LassoAdapter({})

    def test_factory_resolves_lasso(self):
        adapter = get_crm_adapter("lasso", {"api_key": "secret"})

        self.assertIsInstance(adapter, LassoAdapter)

    def test_factory_rejects_unknown_provider_with_lasso_in_message(self):
        with self.assertRaises(HTTPException) as exc:
            get_crm_adapter("unknown", {"api_key": "secret"})

        self.assertIn("lasso", exc.exception.detail)

    @patch("connectors.crm_adapters.lasso_adapter.requests.get")
    def test_test_connection_uses_bearer_jwt_auth_and_project_scope(self, get_mock):
        get_mock.return_value = mock_response(200, {"results": []})

        adapter = LassoAdapter({"api_key": "secret", "project_id": "project-1"})
        result = adapter.test_connection()

        self.assertTrue(result.success)
        get_mock.assert_called_once()
        _, kwargs = get_mock.call_args
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer secret")
        self.assertEqual(kwargs["params"]["projectId"], "project-1")

    @patch("connectors.crm_adapters.lasso_adapter.requests.get")
    def test_auth_header_compacts_wrapped_jwt(self, get_mock):
        get_mock.return_value = mock_response(200, {"results": []})

        adapter = LassoAdapter({"api_key": " eyJ.one \n two.three "})
        result = adapter.test_connection()

        self.assertTrue(result.success)
        _, kwargs = get_mock.call_args
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer eyJ.onetwo.three")

    @patch("connectors.crm_adapters.lasso_adapter.requests.get")
    def test_connection_surfaces_lasso_auth_response(self, get_mock):
        get_mock.return_value = mock_response(
            403,
            {"message": "Project access denied"},
            text='{"message":"Project access denied"}',
        )

        adapter = LassoAdapter({"api_key": "secret"})
        result = adapter.test_connection()

        self.assertFalse(result.success)
        self.assertIn("Project access denied", result.error)

    @patch("connectors.crm_adapters.lasso_adapter.requests.get")
    def test_public_registration_credentials_skip_read_connection_test(self, get_mock):
        adapter = LassoAdapter({
            "api_key": "eyJ.token.value",
            "client_id": "920",
            "project_id": "23969",
        })

        result = adapter.test_connection()

        self.assertTrue(result.success)
        self.assertEqual(result.api_version, "public-registration")
        get_mock.assert_not_called()

    def test_compact_lasso_token_rejects_masked_value(self):
        with self.assertRaisesRegex(ValueError, "masked characters"):
            _compact_lasso_token("••••••••••••••")

    def test_compact_lasso_token_rejects_non_ascii_value(self):
        with self.assertRaisesRegex(ValueError, "non-ASCII"):
            _compact_lasso_token("eyJ.valid.until.é")

    @patch("connectors.crm_adapters.lasso_adapter.requests.get")
    def test_search_lead_finds_by_email(self, get_mock):
        get_mock.return_value = mock_response(
            200,
            {
                "results": [
                    {
                        "registrantId": "lasso-123",
                        "emails": [{"email": "jane@example.com"}],
                    }
                ]
            },
        )

        adapter = LassoAdapter({"api_key": "secret"})
        result = adapter.search_lead("jane@example.com")

        self.assertTrue(result.found)
        self.assertEqual(result.external_id, "lasso-123")
        self.assertEqual(result.match_type, "email")

    @patch("connectors.crm_adapters.lasso_adapter.requests.get")
    def test_search_lead_falls_back_to_phone(self, get_mock):
        get_mock.side_effect = [
            mock_response(200, {"results": []}),
            mock_response(200, {"results": [{"registrant_id": "lasso-phone"}]}),
        ]

        adapter = LassoAdapter({"api_key": "secret"})
        result = adapter.search_lead("jane@example.com", "555-000-0000")

        self.assertTrue(result.found)
        self.assertEqual(result.external_id, "lasso-phone")
        self.assertEqual(result.match_type, "phone")

    @patch("connectors.crm_adapters.lasso_adapter.requests.post")
    def test_create_lead_builds_lasso_registrant_payload(self, post_mock):
        post_mock.return_value = mock_response(201, {"registrantId": "lasso-456"})

        adapter = LassoAdapter({"api_key": "secret", "project_id": "project-1"})
        result = adapter.create_lead(
            {
                "first_name": "Jane",
                "last_name": "Doe",
                "email": "jane@example.com",
                "phone": "555-000-0000",
                "source": "TourSpark",
                "move_in_date": "2026-06-01",
                "bedrooms": 2,
                "notes": "Interested in a corner unit.",
            }
        )

        self.assertTrue(result.success)
        self.assertEqual(result.external_id, "lasso-456")
        _, kwargs = post_mock.call_args
        payload = kwargs["json"]
        self.assertEqual(
            payload["emails"],
            [{"email": "jane@example.com", "type": "Home", "primary": True}],
        )
        self.assertEqual(
            payload["phones"],
            [{"phone": "555-000-0000", "type": "Mobile", "primary": True}],
        )
        self.assertEqual(payload["notes"], [{"note": "Interested in a corner unit."}])
        self.assertEqual(payload["project_id"], "project-1")
        self.assertIn(
            "Desired move-in date: 2026-06-01",
            payload["history"][0]["body"],
        )

    @patch("connectors.crm_adapters.lasso_adapter.requests.post")
    def test_create_lead_builds_public_registration_payload(self, post_mock):
        post_mock.return_value = mock_response(201, {"registrantId": "lasso-456"})

        adapter = LassoAdapter({
            "api_key": "secret",
            "client_id": "920",
            "project_id": "23969",
        })
        result = adapter.create_lead({
            "first_name": "Jane",
            "last_name": "Doe",
            "email": "jane@example.com",
        })

        self.assertTrue(result.success)
        _, kwargs = post_mock.call_args
        payload = kwargs["json"]
        self.assertEqual(payload["clientId"], 920)
        self.assertEqual(payload["projectIds"], [23969])

    @patch("connectors.crm_adapters.lasso_adapter.requests.post")
    def test_create_lead_surfaces_api_error(self, post_mock):
        post_mock.return_value = mock_response(
            400,
            {"message": "email is invalid"},
            text='{"message":"email is invalid"}',
        )

        adapter = LassoAdapter({"api_key": "secret"})
        result = adapter.create_lead({"email": "bad"})

        self.assertFalse(result.success)
        self.assertIn("email is invalid", result.error)

    @patch("routers.crm_integration.get_supabase_client")
    def test_save_mapping_sets_validation_timestamp(self, get_supabase_client_mock):
        execute_mock = Mock(return_value=Mock(data=[]))
        upsert_mock = Mock(return_value=Mock(execute=execute_mock))
        table_mock = Mock(return_value=Mock(upsert=upsert_mock))
        get_supabase_client_mock.return_value = Mock(table=table_mock)

        response = asyncio.run(
            save_mapping(
                SaveMappingRequest(
                    property_id="00000000-0000-0000-0000-000000000001",
                    crm_type="lasso",
                    credentials={"api_key": "secret"},
                    field_mapping={"first_name": "first_name"},
                    validated=True,
                ),
                api_key="engine-key",
            )
        )

        self.assertTrue(response["success"])
        upsert_payload = upsert_mock.call_args.args[0]
        self.assertEqual(upsert_payload["platform"], "lasso")
        self.assertTrue(upsert_payload["mapping_validated"])
        self.assertIsNotNone(upsert_payload["mapping_validated_at"])

    def test_validate_mapping_accepts_lasso_public_registration_key_without_test_write(self):
        response = asyncio.run(
            validate_mapping(
                ValidateMappingRequest(
                    property_id="00000000-0000-0000-0000-000000000001",
                    crm_type="lasso",
                    credentials={
                        "api_key": "eyJ.token.value",
                        "client_id": "920",
                        "project_id": "23969",
                    },
                    field_mapping={"first_name": "first_name"},
                ),
                api_key="engine-key",
            )
        )

        self.assertTrue(response["valid"])
        self.assertIn("write-only", response["warnings"][0])


if __name__ == "__main__":
    unittest.main()
