"""
Lasso CRM Adapter
Supports Lasso registrant APIs for lead management.
"""

import logging
from typing import Any, Dict, List, Optional

import requests

from .base import (
    BaseCRMAdapter,
    CRMSchema,
    CRMField,
    FieldType,
    SearchResult,
    CreateResult,
    ConnectionResult,
)

logger = logging.getLogger(__name__)


def _compact_lasso_token(raw_token: str) -> str:
    """Normalize and validate a Lasso JWT API token for HTTP headers."""
    token = raw_token.strip()
    has_bearer_prefix = token.lower().startswith("bearer ")
    token_body = token[7:] if has_bearer_prefix else token
    compact_body = "".join(token_body.split())

    if not compact_body:
        raise ValueError("Missing required Lasso credentials: api_key")

    if any(char in compact_body for char in ("•", "●")) or set(compact_body) == {"*"}:
        raise ValueError(
            "Paste the actual Lasso API token. The value received contains masked characters."
        )

    try:
        compact_body.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValueError(
            "Lasso API token contains non-ASCII characters. Copy the token again from Lasso using Copy to Clipboard."
        ) from exc

    return f"Bearer {compact_body}"


class LassoAdapter(BaseCRMAdapter):
    """
    Lasso CRM API adapter.

    Credentials required:
    - api_key: Lasso API key / bearer token

    Credentials optional:
    - api_endpoint: Base URL for Lasso API (defaults to https://api.lassocrm.com/v1)
    - project_id: Lasso project/community identifier when the account requires scoping
    - community_id: Alias for project_id used by some operators
    - rotation_id: Optional Lasso sales rotation assignment
    - thank_you_email_template_id: Optional Lasso thank-you email template
    - timeout: Request timeout in seconds
    """

    DEFAULT_API_ENDPOINT = "https://api.lassocrm.com/v1"

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.api_endpoint = (
            credentials.get("api_endpoint") or self.DEFAULT_API_ENDPOINT
        ).rstrip("/")
        self.api_key = credentials.get("api_key", "")
        self.project_id = credentials.get("project_id") or credentials.get("community_id")
        self.rotation_id = credentials.get("rotation_id")
        self.thank_you_email_template_id = credentials.get(
            "thank_you_email_template_id"
        )
        self.timeout = credentials.get("timeout", 30)

    def _validate_credentials(self) -> None:
        """Validate required credentials are present."""
        if not self.credentials.get("api_key"):
            raise ValueError("Missing required Lasso credentials: api_key")

    def _get_headers(self) -> Dict[str, str]:
        """Get standard headers for Lasso API requests."""
        compact_token = _compact_lasso_token(self.api_key)

        return {
            # Lasso CRM requires a Bearer JWT API key in Authorization. Compact
            # copied tokens because the dashboard can display long JWTs wrapped.
            "Authorization": compact_token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _scoped_params(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Add project/community scope to query params when configured."""
        scoped = dict(params or {})
        if self.project_id:
            scoped["projectId"] = self.project_id
        return scoped

    def _extract_results(self, data: Any) -> List[Dict[str, Any]]:
        """Normalize common Lasso collection response shapes."""
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if not isinstance(data, dict):
            return []

        for key in ("results", "registrants", "data", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]

        embedded = data.get("_embedded")
        if isinstance(embedded, dict):
            for key in ("registrants", "items"):
                value = embedded.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]

        return []

    def _extract_external_id(self, data: Dict[str, Any]) -> Optional[str]:
        """Extract the Lasso registrant id from common response shapes."""
        for key in ("registrantId", "registrant_id", "id", "externalId"):
            value = data.get(key)
            if value:
                return str(value)

        links = data.get("_links")
        if isinstance(links, dict):
            self_link = links.get("self")
            href = self_link.get("href") if isinstance(self_link, dict) else self_link
            if isinstance(href, str) and href.rstrip("/").split("/")[-1]:
                return href.rstrip("/").split("/")[-1]

        return None

    def _error_from_response(self, response: requests.Response) -> str:
        """Build a concise, operator-readable API error."""
        try:
            data = response.json()
            if isinstance(data, dict):
                for key in (
                    "message",
                    "error",
                    "errorMessage",
                    "friendlyError",
                    "detail",
                ):
                    value = data.get(key)
                    if value:
                        return f"Lasso API returned {response.status_code}: {value}"
        except ValueError:
            pass

        return f"Lasso API returned {response.status_code}: {response.text[:200]}"

    def test_connection(self) -> ConnectionResult:
        """Test API connection with a low-impact registrant search."""
        logger.info("[Lasso] Testing connection to %s", self.api_endpoint)

        try:
            response = requests.get(
                f"{self.api_endpoint}/registrants/search",
                headers=self._get_headers(),
                params=self._scoped_params(
                    {"email": "tourspark.connection.test@example.com"}
                ),
                timeout=self.timeout,
            )

            if response.status_code in (200, 204, 404):
                return ConnectionResult(
                    success=True,
                    message="Successfully connected to Lasso",
                    api_version="v1",
                )
            if response.status_code in (401, 403):
                return ConnectionResult(
                    success=False,
                    error=self._error_from_response(response),
                )
            if response.status_code == 429:
                return ConnectionResult(
                    success=False,
                    error="Lasso rate limit exceeded - retry after the vendor-provided window",
                )

            return ConnectionResult(
                success=False,
                error=self._error_from_response(response),
            )

        except requests.exceptions.Timeout:
            return ConnectionResult(success=False, error="Connection timeout")
        except requests.exceptions.ConnectionError as e:
            return ConnectionResult(success=False, error=f"Connection error: {str(e)}")
        except Exception as e:
            logger.error("[Lasso] Connection test failed: %s", e)
            return ConnectionResult(success=False, error=str(e))

    def get_schema(self) -> CRMSchema:
        """Return Lasso registrant fields used by the TourSpark mapping flow."""
        return CRMSchema(
            crm_type="lasso",
            api_version="v1",
            object_name="Registrant",
            object_label="Registrant",
            fields=[
                CRMField(
                    name="first_name",
                    label="First Name",
                    type=FieldType.STRING,
                    required=True,
                ),
                CRMField(
                    name="last_name",
                    label="Last Name",
                    type=FieldType.STRING,
                    required=True,
                ),
                CRMField(name="email", label="Email", type=FieldType.EMAIL, required=False),
                CRMField(name="phone", label="Phone", type=FieldType.PHONE, required=False),
                CRMField(
                    name="source",
                    label="Lead Source",
                    type=FieldType.STRING,
                    required=False,
                ),
                CRMField(name="status", label="Status", type=FieldType.STRING, required=False),
                CRMField(
                    name="move_in_date",
                    label="Move-in Date",
                    type=FieldType.DATE,
                    required=False,
                ),
                CRMField(
                    name="bedrooms",
                    label="Bedroom Preference",
                    type=FieldType.STRING,
                    required=False,
                ),
                CRMField(
                    name="notes",
                    label="Notes",
                    type=FieldType.TEXT,
                    required=False,
                    max_length=4000,
                ),
                CRMField(
                    name="project_id",
                    label="Project ID",
                    type=FieldType.STRING,
                    required=False,
                ),
                CRMField(
                    name="external_id",
                    label="External ID",
                    type=FieldType.STRING,
                    required=False,
                ),
            ],
        )

    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """Search for an existing Lasso registrant by email and then phone."""
        logger.info("[Lasso] Searching for registrant: email='%s'", email)

        try:
            if email and email.strip():
                result = self._search_registrants({"email": email.strip()}, "email")
                if result.found:
                    return result

            if phone and phone.strip():
                return self._search_registrants({"phone": phone.strip()}, "phone")

            return SearchResult(found=False)

        except Exception as e:
            logger.error("[Lasso] Registrant search failed: %s", e)
            return SearchResult(found=False, error=str(e))

    def _search_registrants(self, params: Dict[str, Any], match_type: str) -> SearchResult:
        response = requests.get(
            f"{self.api_endpoint}/registrants/search",
            headers=self._get_headers(),
            params=self._scoped_params(params),
            timeout=self.timeout,
        )

        if response.status_code == 404:
            return SearchResult(found=False)

        if response.status_code != 200:
            return SearchResult(found=False, error=self._error_from_response(response))

        results = self._extract_results(response.json())
        if not results:
            return SearchResult(found=False)

        registrant = results[0]
        return SearchResult(
            found=True,
            external_id=self._extract_external_id(registrant),
            match_type=match_type,
            existing_data=registrant,
        )

    def create_lead(self, mapped_data: Dict[str, Any]) -> CreateResult:
        """Create a new Lasso registrant."""
        logger.info("[Lasso] Creating registrant")

        try:
            payload = self._build_registrant_payload(mapped_data)
            response = requests.post(
                f"{self.api_endpoint}/registrants",
                headers=self._get_headers(),
                json=payload,
                timeout=self.timeout,
            )

            if response.status_code in (200, 201, 202):
                data = response.json()
                external_id = self._extract_external_id(data)
                return CreateResult(
                    success=True,
                    external_id=external_id,
                    raw_response=data,
                )

            return CreateResult(success=False, error=self._error_from_response(response))

        except Exception as e:
            logger.error("[Lasso] Registrant creation failed: %s", e)
            return CreateResult(success=False, error=str(e))

    def _build_registrant_payload(self, mapped_data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert flat mapped fields into Lasso's registrant payload shape."""
        payload: Dict[str, Any] = {
            key: value for key, value in mapped_data.items() if value not in (None, "")
        }

        email = payload.pop("email", None)
        if email:
            payload["emails"] = [{"email": email, "type": "Home", "primary": True}]

        phone = payload.pop("phone", None)
        if phone:
            payload["phones"] = [
                {"phone": str(phone), "type": "Mobile", "primary": True}
            ]

        notes = payload.pop("notes", None)
        if notes:
            payload["notes"] = [{"note": str(notes)}]

        source = payload.pop("source", None)
        status = payload.pop("status", None)
        move_in_date = payload.pop("move_in_date", None)
        bedrooms = payload.pop("bedrooms", None)
        history_parts = []
        if source:
            history_parts.append(f"Source: {source}")
        if status:
            history_parts.append(f"TourSpark status: {status}")
        if move_in_date:
            history_parts.append(f"Desired move-in date: {move_in_date}")
        if bedrooms:
            history_parts.append(f"Bedroom preference: {bedrooms}")
        if history_parts:
            payload["history"] = [{"body": "\n".join(history_parts)}]

        if self.project_id and "project_id" not in payload:
            payload["project_id"] = self.project_id
        if self.rotation_id and "rotation_id" not in payload:
            payload["rotation_id"] = self.rotation_id
        if (
            self.thank_you_email_template_id
            and "thank_you_email_template_id" not in payload
        ):
            payload["thank_you_email_template_id"] = self.thank_you_email_template_id

        return payload

    def get_lead(self, external_id: str) -> Dict[str, Any]:
        """Get a Lasso registrant by ID."""
        response = requests.get(
            f"{self.api_endpoint}/registrants/{external_id}",
            headers=self._get_headers(),
            timeout=self.timeout,
        )

        if response.status_code == 200:
            return response.json()

        raise ValueError(self._error_from_response(response))

    def delete_lead(self, external_id: str) -> bool:
        """Delete a Lasso registrant by ID when the tenant API permits cleanup."""
        response = requests.delete(
            f"{self.api_endpoint}/registrants/{external_id}",
            headers=self._get_headers(),
            timeout=self.timeout,
        )

        if response.status_code in (200, 202, 204, 404):
            return True

        logger.warning(
            "[Lasso] Test registrant cleanup failed: %s",
            self._error_from_response(response),
        )
        return False
