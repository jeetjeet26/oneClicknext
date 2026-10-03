"""
Yardi CRM Adapter
Supports both Yardi Voyager (SOAP) and RENTCafé (REST) APIs
"""

import requests
import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

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


class YardiAdapter(BaseCRMAdapter):
    """
    Yardi RENTCafé API adapter.
    
    Supports:
    - Guest Card (Prospect) creation
    - Lead search by email/phone
    - Schema introspection
    
    Credentials required:
    - api_endpoint: Base URL for RENTCafé API
    - api_key: API key or token
    - property_code: Property code in Yardi
    - api_type: 'rentcafe' (default) or 'voyager'
    """
    
    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.api_endpoint = credentials.get('api_endpoint', '').rstrip('/')
        self.api_key = credentials.get('api_key', '')
        self.property_code = credentials.get('property_code', '')
        self.api_type = credentials.get('api_type', 'rentcafe')
        self.timeout = credentials.get('timeout', 30)
    
    def _validate_credentials(self) -> None:
        """Validate required credentials are present."""
        required = ['api_endpoint', 'api_key', 'property_code']
        missing = [f for f in required if not self.credentials.get(f)]
        if missing:
            raise ValueError(f"Missing required Yardi credentials: {', '.join(missing)}")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get standard headers for API requests."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
    
    def test_connection(self) -> ConnectionResult:
        """Test API connection with provided credentials."""
        logger.info(f"[Yardi] Testing connection to {self.api_endpoint}")
        
        try:
            # Try to get property info as connection test
            response = self.read_get(
                f"{self.api_endpoint}/properties/{self.property_code}",
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                return ConnectionResult(
                    success=True,
                    message="Successfully connected to Yardi RENTCafé",
                    api_version=self.api_type
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
            logger.error(f"[Yardi] Connection test failed: {e}")
            return ConnectionResult(success=False, error=str(e))
    
    def get_schema(self) -> CRMSchema:
        """
        Introspect Yardi schema via API.
        Falls back to default schema if introspection not supported.
        """
        logger.info(f"[Yardi] Getting schema for {self.api_type}")
        
        try:
            # Try RENTCafé schema endpoint
            response = self.read_get(
                f"{self.api_endpoint}/schema/guestcard",
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                schema_data = response.json()
                fields = self._normalize_fields(schema_data.get('fields', []))
                
                return CRMSchema(
                    crm_type="yardi",
                    api_version=self.api_type,
                    object_name="GuestCard",
                    object_label="Guest Card (Prospect)",
                    fields=fields,
                    evidence_source="provider_response"
                )
            else:
                logger.warning(f"[Yardi] Schema endpoint not available, using defaults")
                return self._get_default_schema()
                
        except Exception as e:
            logger.warning(f"[Yardi] Schema introspection failed: {e}, using defaults")
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
        """Return default Yardi Guest Card schema."""
        return CRMSchema(
            crm_type="yardi",
            api_version="default",
            object_name="GuestCard",
            object_label="Guest Card",
            fields=[
                CRMField(name="FirstName", label="First Name", type=FieldType.STRING, required=True),
                CRMField(name="LastName", label="Last Name", type=FieldType.STRING, required=True),
                CRMField(name="Email", label="Email", type=FieldType.EMAIL, required=False),
                CRMField(name="PhoneNumber", label="Phone Number", type=FieldType.PHONE, required=False),
                CRMField(name="CellPhone", label="Cell Phone", type=FieldType.PHONE, required=False),
                CRMField(name="WorkPhone", label="Work Phone", type=FieldType.PHONE, required=False),
                CRMField(name="LeadSource", label="Lead Source", type=FieldType.STRING, required=False),
                CRMField(name="Status", label="Status", type=FieldType.PICKLIST, required=False),
                CRMField(name="MoveInDate", label="Move-in Date", type=FieldType.DATE, required=False),
                CRMField(name="DesiredBedrooms", label="Desired Bedrooms", type=FieldType.STRING, required=False),
                CRMField(name="DesiredRent", label="Desired Rent", type=FieldType.NUMBER, required=False),
                CRMField(name="Comments", label="Comments/Notes", type=FieldType.TEXT, required=False, max_length=2000),
                CRMField(name="PreferredContactMethod", label="Preferred Contact Method", type=FieldType.PICKLIST, required=False),
            ]
        )
    
    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """
        Search for existing lead in Yardi by email and/or phone.
        """
        logger.info(f"[Yardi] Searching for lead: {email}")
        
        try:
            # Search by email first
            response = self.read_get(
                f"{self.api_endpoint}/guestcards/search",
                headers=self._get_headers(),
                params={
                    "propertyCode": self.property_code,
                    "email": email
                },
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                data = response.json()
                results = data.get('results', data.get('guestCards', []))
                
                if results and len(results) > 0:
                    lead = results[0]
                    return SearchResult(
                        found=True,
                        external_id=lead.get('GuestCardID') or lead.get('ProspectID') or lead.get('id'),
                        match_type="email",
                        existing_data=lead
                    )
            
            # If not found by email and phone provided, try phone
            if phone:
                response = self.read_get(
                    f"{self.api_endpoint}/guestcards/search",
                    headers=self._get_headers(),
                    params={
                        "propertyCode": self.property_code,
                        "phone": phone
                    },
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    data = response.json()
                    results = data.get('results', data.get('guestCards', []))
                    
                    if results and len(results) > 0:
                        lead = results[0]
                        return SearchResult(
                            found=True,
                            external_id=lead.get('GuestCardID') or lead.get('ProspectID') or lead.get('id'),
                            match_type="phone",
                            existing_data=lead
                        )
            
            return SearchResult(found=False)
            
        except Exception as e:
            logger.error(f"[Yardi] Lead search failed: {e}")
            return SearchResult(found=False, error=str(e))
    
    def create_lead(self, mapped_data: Dict[str, Any]) -> CreateResult:
        """Create a new Guest Card in Yardi."""
        logger.info(f"[Yardi] Creating guest card")
        
        try:
            payload = {
                "PropertyCode": self.property_code,
                **mapped_data
            }
            
            response = requests.post(
                f"{self.api_endpoint}/guestcards",
                headers=self._get_headers(),
                json=payload,
                timeout=self.timeout
            )
            
            if response.status_code in [200, 201]:
                data = response.json()
                external_id = (
                    data.get('GuestCardID') or 
                    data.get('ProspectID') or 
                    data.get('id') or
                    data.get('data', {}).get('id')
                )
                
                logger.info(f"[Yardi] Guest card created: {external_id}")
                return CreateResult(
                    success=True,
                    external_id=str(external_id) if external_id else None,
                    raw_response=data
                )
            else:
                error_msg = f"API returned {response.status_code}: {response.text[:500]}"
                logger.error(f"[Yardi] Create failed: {error_msg}")
                return CreateResult(success=False, error=error_msg)
                
        except Exception as e:
            logger.error(f"[Yardi] Create lead failed: {e}")
            return CreateResult(success=False, error=str(e))
    
    def get_lead(self, external_id: str) -> Dict[str, Any]:
        """Get Guest Card by ID."""
        logger.info(f"[Yardi] Getting guest card: {external_id}")
        
        try:
            response = self.read_get(
                f"{self.api_endpoint}/guestcards/{external_id}",
                headers=self._get_headers(),
                params={"propertyCode": self.property_code},
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                raise Exception(f"API returned {response.status_code}")
                
        except Exception as e:
            logger.error(f"[Yardi] Get lead failed: {e}")
            raise
    
    def delete_lead(self, external_id: str) -> bool:
        """Delete Guest Card (for test sync cleanup)."""
        logger.info(f"[Yardi] Deleting guest card: {external_id}")
        
        try:
            response = requests.delete(
                f"{self.api_endpoint}/guestcards/{external_id}",
                headers=self._get_headers(),
                params={"propertyCode": self.property_code},
                timeout=self.timeout
            )
            
            if response.status_code in [200, 204]:
                logger.info(f"[Yardi] Guest card deleted: {external_id}")
                return True
            else:
                logger.warning(f"[Yardi] Delete returned {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"[Yardi] Delete lead failed: {e}")
            return False

