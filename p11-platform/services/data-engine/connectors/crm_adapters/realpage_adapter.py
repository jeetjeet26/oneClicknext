"""
RealPage CRM Adapter
Supports RealPage OneSite API for lead management
"""

import requests
import logging
from typing import Dict, Any, Optional, List

from .base import (
    BaseCRMAdapter, 
    CRMSchema, 
    CRMField, 
    FieldType,
    SearchResult, 
    CreateResult, 
    ConnectionResult
)

logger = logging.getLogger(__name__)


class RealPageAdapter(BaseCRMAdapter):
    """
    RealPage OneSite API adapter.
    
    Supports:
    - Prospect creation
    - Lead search by email/phone
    - Schema introspection
    
    Credentials required:
    - api_endpoint: Base URL for RealPage API
    - api_key: API key or token
    - property_code: Property code in RealPage
    - company_code: Company/Site code
    """
    
    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.api_endpoint = credentials.get('api_endpoint', '').rstrip('/')
        self.api_key = credentials.get('api_key', '')
        self.property_code = credentials.get('property_code', '')
        self.company_code = credentials.get('company_code', '')
        self.timeout = credentials.get('timeout', 30)
    
    def _validate_credentials(self) -> None:
        """Validate required credentials are present."""
        required = ['api_endpoint', 'api_key', 'property_code']
        missing = [f for f in required if not self.credentials.get(f)]
        if missing:
            raise ValueError(f"Missing required RealPage credentials: {', '.join(missing)}")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get standard headers for API requests."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-RealPage-Site": self.property_code,
        }
    
    def test_connection(self) -> ConnectionResult:
        """Test API connection with provided credentials."""
        logger.info(f"[RealPage] Testing connection to {self.api_endpoint}")
        
        try:
            # Try to get property/site info as connection test
            response = self.read_get(
                f"{self.api_endpoint}/sites/{self.property_code}",
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                data = response.json()
                return ConnectionResult(
                    success=True,
                    message="Successfully connected to RealPage OneSite",
                    api_version=data.get('apiVersion', 'v1')
                )
            elif response.status_code == 401:
                return ConnectionResult(
                    success=False,
                    error="Authentication failed - check API key"
                )
            elif response.status_code == 404:
                return ConnectionResult(
                    success=False,
                    error=f"Property code '{self.property_code}' not found"
                )
            else:
                return ConnectionResult(
                    success=False,
                    error=f"API returned status {response.status_code}: {response.text[:200]}"
                )
                
        except requests.exceptions.Timeout:
            return ConnectionResult(success=False, error="Connection timeout")
        except requests.exceptions.ConnectionError as e:
            return ConnectionResult(success=False, error=f"Connection error: {str(e)}")
        except Exception as e:
            logger.error(f"[RealPage] Connection test failed: {e}")
            return ConnectionResult(success=False, error=str(e))
    
    def get_schema(self) -> CRMSchema:
        """
        Get RealPage prospect schema.
        Falls back to default schema if introspection not supported.
        """
        logger.info(f"[RealPage] Getting schema")
        
        try:
            response = self.read_get(
                f"{self.api_endpoint}/schema/prospects",
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                schema_data = response.json()
                fields = self._normalize_fields(schema_data.get('fields', []))
                
                return CRMSchema(
                    crm_type="realpage",
                    api_version="v1",
                    object_name="Prospect",
                    object_label="Prospect",
                    fields=fields,
                    evidence_source="provider_response"
                )
            else:
                logger.warning(f"[RealPage] Schema endpoint not available, using defaults")
                return self._get_default_schema()
                
        except Exception as e:
            logger.warning(f"[RealPage] Schema introspection failed: {e}, using defaults")
            return self._get_default_schema()
    
    def _normalize_fields(self, fields: List[Dict[str, Any]]) -> List[CRMField]:
        """Normalize field definitions from API to standard format."""
        normalized = []
        
        type_map = {
            'String': FieldType.STRING,
            'Email': FieldType.EMAIL,
            'Phone': FieldType.PHONE,
            'Date': FieldType.DATE,
            'DateTime': FieldType.DATETIME,
            'Number': FieldType.NUMBER,
            'Integer': FieldType.NUMBER,
            'Boolean': FieldType.BOOLEAN,
            'Picklist': FieldType.PICKLIST,
            'Text': FieldType.TEXT,
        }
        
        for field in fields:
            field_type = type_map.get(field.get('type', 'String'), FieldType.STRING)
            
            normalized.append(CRMField(
                name=field.get('name', ''),
                label=field.get('label', field.get('name', '')),
                type=field_type,
                required=field.get('required', False),
                max_length=field.get('maxLength'),
                picklist_values=field.get('picklistValues', []),
                custom_field=field.get('custom', False),
                description=field.get('description', '')
            ))
        
        return normalized
    
    def _get_default_schema(self) -> CRMSchema:
        """Return default RealPage Prospect schema."""
        return CRMSchema(
            crm_type="realpage",
            api_version="default",
            object_name="Prospect",
            object_label="Prospect",
            fields=[
                CRMField(name="FirstName", label="First Name", type=FieldType.STRING, required=True),
                CRMField(name="LastName", label="Last Name", type=FieldType.STRING, required=True),
                CRMField(name="Email", label="Email", type=FieldType.EMAIL, required=False),
                CRMField(name="Phone", label="Phone", type=FieldType.PHONE, required=False),
                CRMField(name="CellPhone", label="Cell Phone", type=FieldType.PHONE, required=False),
                CRMField(name="WorkPhone", label="Work Phone", type=FieldType.PHONE, required=False),
                CRMField(name="LeadSource", label="Lead Source", type=FieldType.STRING, required=False),
                CRMField(name="LeadStatus", label="Lead Status", type=FieldType.PICKLIST, required=False),
                CRMField(name="MoveInDate", label="Move-in Date", type=FieldType.DATE, required=False),
                CRMField(name="BedroomPreference", label="Bedroom Preference", type=FieldType.STRING, required=False),
                CRMField(name="PriceRangeMin", label="Min Price", type=FieldType.NUMBER, required=False),
                CRMField(name="PriceRangeMax", label="Max Price", type=FieldType.NUMBER, required=False),
                CRMField(name="Notes", label="Notes", type=FieldType.TEXT, required=False, max_length=4000),
                CRMField(name="ContactMethod", label="Preferred Contact Method", type=FieldType.PICKLIST, required=False),
            ]
        )
    
    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """Search for existing prospect in RealPage by email and/or phone."""
        logger.info(f"[RealPage] Searching for prospect: {email}")
        
        try:
            # Search by email
            response = self.read_get(
                f"{self.api_endpoint}/prospects/search",
                headers=self._get_headers(),
                params={
                    "siteId": self.property_code,
                    "email": email
                },
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                data = response.json()
                results = data.get('results', data.get('prospects', []))
                
                if results and len(results) > 0:
                    prospect = results[0]
                    return SearchResult(
                        found=True,
                        external_id=prospect.get('ProspectId') or prospect.get('id'),
                        match_type="email",
                        existing_data=prospect
                    )
            
            # Try phone search
            if phone:
                response = self.read_get(
                    f"{self.api_endpoint}/prospects/search",
                    headers=self._get_headers(),
                    params={
                        "siteId": self.property_code,
                        "phone": phone
                    },
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    data = response.json()
                    results = data.get('results', data.get('prospects', []))
                    
                    if results and len(results) > 0:
                        prospect = results[0]
                        return SearchResult(
                            found=True,
                            external_id=prospect.get('ProspectId') or prospect.get('id'),
                            match_type="phone",
                            existing_data=prospect
                        )
            
            return SearchResult(found=False)
            
        except Exception as e:
            logger.error(f"[RealPage] Prospect search failed: {e}")
            return SearchResult(found=False, error=str(e))
    
    def create_lead(self, mapped_data: Dict[str, Any]) -> CreateResult:
        """Create a new Prospect in RealPage."""
        logger.info(f"[RealPage] Creating prospect")
        
        try:
            payload = {
                "SiteId": self.property_code,
                **mapped_data
            }
            
            response = requests.post(
                f"{self.api_endpoint}/prospects",
                headers=self._get_headers(),
                json=payload,
                timeout=self.timeout
            )
            
            if response.status_code in [200, 201]:
                data = response.json()
                external_id = (
                    data.get('ProspectId') or 
                    data.get('id') or
                    data.get('data', {}).get('id')
                )
                
                logger.info(f"[RealPage] Prospect created: {external_id}")
                return CreateResult(
                    success=True,
                    external_id=str(external_id) if external_id else None,
                    raw_response=data
                )
            else:
                error_msg = f"API returned {response.status_code}: {response.text[:500]}"
                logger.error(f"[RealPage] Create failed: {error_msg}")
                return CreateResult(success=False, error=error_msg)
                
        except Exception as e:
            logger.error(f"[RealPage] Create prospect failed: {e}")
            return CreateResult(success=False, error=str(e))
    
    def get_lead(self, external_id: str) -> Dict[str, Any]:
        """Get Prospect by ID."""
        logger.info(f"[RealPage] Getting prospect: {external_id}")
        
        try:
            response = self.read_get(
                f"{self.api_endpoint}/prospects/{external_id}",
                headers=self._get_headers(),
                params={"siteId": self.property_code},
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                raise Exception(f"API returned {response.status_code}")
                
        except Exception as e:
            logger.error(f"[RealPage] Get prospect failed: {e}")
            raise
    
    def delete_lead(self, external_id: str) -> bool:
        """Delete Prospect (for test sync cleanup)."""
        logger.info(f"[RealPage] Deleting prospect: {external_id}")
        
        try:
            response = requests.delete(
                f"{self.api_endpoint}/prospects/{external_id}",
                headers=self._get_headers(),
                params={"siteId": self.property_code},
                timeout=self.timeout
            )
            
            if response.status_code in [200, 204]:
                logger.info(f"[RealPage] Prospect deleted: {external_id}")
                return True
            else:
                logger.warning(f"[RealPage] Delete returned {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"[RealPage] Delete prospect failed: {e}")
            return False

