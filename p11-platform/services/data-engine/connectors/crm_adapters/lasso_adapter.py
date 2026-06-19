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
    - client_id: Lasso client identifier from View Registration Page Code
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
        self.client_id = credentials.get("client_id")
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

    def _question_field_name(self, question_id: Any) -> Optional[str]:
        if question_id in (None, ""):
            return None

        normalized = str(question_id).strip()
        return f"question_{normalized}" if normalized else None

    def _field_type_from_question(self, question_type: Any) -> FieldType:
        normalized = str(question_type or "").lower()
        if "date" in normalized:
            return FieldType.DATE
        if "checkbox" in normalized or "select" in normalized or "radio" in normalized:
            return FieldType.PICKLIST
        return FieldType.TEXT

    def _default_schema_fields(self) -> List[CRMField]:
        return [
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
        ]

    def _extract_question_fields(self, settings: Dict[str, Any]) -> List[CRMField]:
        questions = settings.get("questions")
        if not isinstance(questions, list):
            return []

        fields: List[CRMField] = []
        for question in questions:
            if not isinstance(question, dict):
                continue

            question_id = (
                question.get("questionId")
                or question.get("question_id")
                or question.get("id")
            )
            field_name = self._question_field_name(question_id)
            if not field_name:
                continue

            answers = question.get("answers")
            picklist_values: List[str] = []
            if isinstance(answers, list):
                for answer in answers:
                    if isinstance(answer, dict):
                        answer_label = answer.get("answer") or answer.get("name") or answer.get("label")
                        if answer_label:
                            picklist_values.append(str(answer_label))

            question_name = str(question.get("name") or f"Lasso Question {question_id}")
            question_path = question.get("path")
            description_parts = [f"Lasso question ID: {question_id}"]
            if question_path:
                description_parts.append(f"Path: {question_path}")

            fields.append(CRMField(
                name=field_name,
                label=question_name,
                type=self._field_type_from_question(question.get("type")),
                required=False,
                picklist_values=picklist_values,
                custom_field=True,
                description="; ".join(description_parts),
            ))

        return fields

    def _error_from_response(self, response: requests.Response) -> str:
        """Build a concise, operator-readable API error."""
        try:
            data = response.json()
            if isinstance(data, dict):
                validation_errors = data.get("errors")
                if validation_errors:
                    return (
                        f"Lasso API returned {response.status_code}: "
                        f"{str(validation_errors)[:500]}"
                    )
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
            if self.client_id and self.project_id:
                _compact_lasso_token(self.api_key)
                return ConnectionResult(
                    success=True,
                    message=(
                        "Lasso public registration credentials accepted. "
                        "This key may not permit read/search API calls."
                    ),
                    api_version="public-registration",
                )

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
        """Return Lasso registrant fields plus project-specific questions."""
        fields = self._default_schema_fields()

        try:
            response = requests.get(
                f"{self.api_endpoint}/projects/settings",
                headers=self._get_headers(),
                timeout=self.timeout,
            )

            if response.status_code == 200:
                fields.extend(self._extract_question_fields(response.json()))
            else:
                logger.warning(
                    "[Lasso] Project settings schema discovery failed: %s",
                    self._error_from_response(response),
                )
        except Exception as e:
            logger.warning("[Lasso] Project settings schema discovery unavailable: %s", e)

        return CRMSchema(
            crm_type="lasso",
            api_version="v1",
            object_name="Registrant",
            object_label="Registrant",
            fields=fields,
        )

    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """Search for an existing Lasso registrant by email and then phone."""
        logger.info("[Lasso] Searching for registrant: email='%s'", email)

        try:
            if self.client_id and self.project_id:
                return SearchResult(found=False)

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
        questions = self._build_question_answers(payload)

        first_name = payload.pop("first_name", None)
        last_name = payload.pop("last_name", None)
        if self.client_id and self.project_id:
            person: Dict[str, Any] = {}
            if first_name:
                person["firstName"] = first_name
            if last_name:
                person["lastName"] = last_name
            if person:
                payload["person"] = person
        else:
            if first_name:
                payload["first_name"] = first_name
            if last_name:
                payload["last_name"] = last_name

        email = payload.pop("email", None)
        if email:
            payload["emails"] = [{"email": email, "type": "Personal", "primary": True}]

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
        if questions:
            payload["questions"] = questions

        if self.client_id and "clientId" not in payload:
            payload["clientId"] = int(self.client_id) if str(self.client_id).isdigit() else self.client_id
        if self.client_id and self.project_id and "projectId" not in payload:
            project_id = int(self.project_id) if str(self.project_id).isdigit() else self.project_id
            payload["projectId"] = project_id
        elif self.project_id and "project_id" not in payload:
            payload["project_id"] = self.project_id
        if self.rotation_id and "rotation_id" not in payload:
            payload["rotation_id"] = self.rotation_id
        if (
            self.thank_you_email_template_id
            and "thank_you_email_template_id" not in payload
        ):
            payload["thank_you_email_template_id"] = self.thank_you_email_template_id

        return payload

    def _build_question_answers(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Move mapped question_<id> values into Lasso's questions payload."""
        questions: List[Dict[str, Any]] = []
        for key in list(payload.keys()):
            if not key.startswith("question_"):
                continue

            question_id = key.removeprefix("question_")
            value = payload.pop(key)
            values = value if isinstance(value, list) else [value]
            answers = [
                {"answer": str(answer)}
                for answer in values
                if answer not in (None, "")
            ]
            if not answers:
                continue

            normalized_id: Any = int(question_id) if question_id.isdigit() else question_id
            questions.append({
                "questionId": normalized_id,
                "answers": answers,
            })

        return questions

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
