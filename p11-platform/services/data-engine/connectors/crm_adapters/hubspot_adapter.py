"""
HubSpot CRM Adapter
Uses hubspot-api-client for HubSpot CRM API
"""

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

try:
    from hubspot import HubSpot
    from hubspot.crm.contacts import SimplePublicObjectInputForCreate, ApiException
    HUBSPOT_AVAILABLE = True
except ImportError:
    HUBSPOT_AVAILABLE = False
    logger.warning("hubspot-api-client not installed. Install with: pip install hubspot-api-client")


class HubSpotAdapter(BaseCRMAdapter):
    """
    HubSpot CRM API adapter using hubspot-api-client.
    
    Supports:
    - Contact object CRUD
    - Property schema introspection
    - Search via HubSpot Search API
    
    Credentials required:
    - access_token: HubSpot private app access token
    
    OR:
    - api_key: HubSpot API key (legacy, being deprecated)
    """
    
    def __init__(self, credentials: Dict[str, Any]):
        if not HUBSPOT_AVAILABLE:
            raise ImportError("hubspot-api-client not installed. Run: pip install hubspot-api-client")
        
        super().__init__(credentials)
        self.client: Optional[HubSpot] = None
        self._connect()
    
    def _validate_credentials(self) -> None:
        """Validate required credentials are present."""
        if not self.credentials.get('access_token') and not self.credentials.get('api_key'):
            raise ValueError("Missing required HubSpot credentials: access_token or api_key")
    
    def _connect(self) -> None:
        """Establish connection to HubSpot."""
        # Map api_key to access_token (UI sends as api_key, but HubSpot private apps use access_token)
        access_token = self.credentials.get('access_token') or self.credentials.get('api_key')
        
        if access_token:
            self.client = HubSpot(access_token=access_token)
        else:
            # Fallback to legacy API key (deprecated by HubSpot)
            self.client = HubSpot(api_key=self.credentials.get('api_key'))
    
    def test_connection(self) -> ConnectionResult:
        """Test API connection by querying account info."""
        logger.info("[HubSpot] Testing connection")
        
        try:
            # Try to get account info
            account_info = self.client.settings.users.users_api.get_page()
            
            return ConnectionResult(
                success=True,
                message="Successfully connected to HubSpot",
                api_version="v3"
            )
            
        except ApiException as e:
            if e.status == 401:
                return ConnectionResult(
                    success=False,
                    error="Authentication failed - check access token"
                )
            return ConnectionResult(success=False, error=str(e))
        except Exception as e:
            # Try alternative: list contacts
            try:
                self.client.crm.contacts.basic_api.get_page(limit=1)
                return ConnectionResult(
                    success=True,
                    message="Successfully connected to HubSpot",
                    api_version="v3"
                )
            except Exception as e2:
                logger.error(f"[HubSpot] Connection test failed: {e2}")
                return ConnectionResult(success=False, error=str(e2))
    
    def get_schema(self) -> CRMSchema:
        """Get HubSpot Contact properties schema."""
        logger.info("[HubSpot] Getting Contact schema")
        
        try:
            # Get all contact properties
            properties = self.client.crm.properties.core_api.get_all(object_type="contacts")
            fields = []
            
            type_map = {
                'string': FieldType.STRING,
                'enumeration': FieldType.PICKLIST,
                'number': FieldType.NUMBER,
                'date': FieldType.DATE,
                'datetime': FieldType.DATETIME,
                'bool': FieldType.BOOLEAN,
                'phone_number': FieldType.PHONE,
            }
            
            for prop in properties.results:
                field_type = type_map.get(prop.type, FieldType.STRING)
                
                # Special handling for email
                if prop.name == 'email':
                    field_type = FieldType.EMAIL
                elif 'phone' in prop.name.lower():
                    field_type = FieldType.PHONE
                
                # Get picklist options
                picklist_values = []
                if prop.options:
                    picklist_values = [opt.value for opt in prop.options]
                
                fields.append(CRMField(
                    name=prop.name,
                    label=prop.label,
                    type=field_type,
                    required=False,  # HubSpot doesn't enforce required at API level
                    description=prop.description or '',
                    picklist_values=picklist_values,
                    custom_field=not prop.name.startswith('hs_')
                ))
            
            return CRMSchema(
                crm_type="hubspot",
                api_version="v3",
                object_name="Contact",
                object_label="Contact",
                fields=fields,
                    evidence_source="provider_response"
            )
            
        except Exception as e:
            logger.error(f"[HubSpot] Schema fetch failed: {e}")
            return self._get_default_schema()
    
    def _get_default_schema(self) -> CRMSchema:
        """Return default HubSpot Contact schema."""
        return CRMSchema(
            crm_type="hubspot",
            api_version="default",
            object_name="Contact",
            object_label="Contact",
            fields=[
                CRMField(name="firstname", label="First Name", type=FieldType.STRING, required=False),
                CRMField(name="lastname", label="Last Name", type=FieldType.STRING, required=False),
                CRMField(name="email", label="Email", type=FieldType.EMAIL, required=False),
                CRMField(name="phone", label="Phone Number", type=FieldType.PHONE, required=False),
                CRMField(name="mobilephone", label="Mobile Phone", type=FieldType.PHONE, required=False),
                CRMField(name="hs_lead_status", label="Lead Status", type=FieldType.PICKLIST, required=False),
                CRMField(name="lifecyclestage", label="Lifecycle Stage", type=FieldType.PICKLIST, required=False),
                CRMField(name="hs_analytics_source", label="Original Source", type=FieldType.STRING, required=False),
                CRMField(name="notes_last_updated", label="Notes", type=FieldType.TEXT, required=False),
                CRMField(name="company", label="Company Name", type=FieldType.STRING, required=False),
                CRMField(name="city", label="City", type=FieldType.STRING, required=False),
                CRMField(name="state", label="State/Region", type=FieldType.STRING, required=False),
                CRMField(name="zip", label="Postal Code", type=FieldType.STRING, required=False),
            ]
        )
    
    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """Search for existing Contact in HubSpot by email and/or phone."""
        logger.info(f"[HubSpot] Searching for contact: email='{email}'")
        
        try:
            # If email is empty or invalid, skip search and create new
            if not email or not email.strip():
                logger.info(f"[HubSpot] No email provided, will create without search")
                return SearchResult(found=False)
            
            # Search by email first
            filter_group = {
                "filters": [
                    {
                        "propertyName": "email",
                        "operator": "EQ",
                        "value": email.strip()
                    }
                ]
            }
            
            public_object_search_request = {
                "filter_groups": [filter_group],
                "properties": ["firstname", "lastname", "email", "phone"],
                "limit": 1
            }
            
            result = self.client.crm.contacts.search_api.do_search(
                public_object_search_request=public_object_search_request
            )
            
            if result.total > 0:
                contact = result.results[0]
                # Verify the email actually matches (case insensitive)
                found_email = contact.properties.get('email', '')
                if found_email.lower() == email.strip().lower():
                    logger.info(f"[HubSpot] Found existing contact: {contact.id} for email: {email}")
                    return SearchResult(
                        found=True,
                        external_id=contact.id,
                        match_type="email",
                        existing_data=contact.properties
                    )
                else:
                    logger.warning(f"[HubSpot] Email mismatch! Searched: {email}, Found: {found_email}")
                    return SearchResult(found=False)
            
            # Try phone search
            if phone:
                phone_clean = ''.join(c for c in phone if c.isdigit())
                filter_group = {
                    "filters": [
                        {
                            "propertyName": "phone",
                            "operator": "CONTAINS_TOKEN",
                            "value": phone_clean[-10:] if len(phone_clean) >= 10 else phone_clean
                        }
                    ]
                }
                
                public_object_search_request["filter_groups"] = [filter_group]
                
                result = self.client.crm.contacts.search_api.do_search(
                    public_object_search_request=public_object_search_request
                )
                
                if result.total > 0:
                    contact = result.results[0]
                    return SearchResult(
                        found=True,
                        external_id=contact.id,
                        match_type="phone",
                        existing_data=contact.properties
                    )
            
            return SearchResult(found=False)
            
        except Exception as e:
            logger.error(f"[HubSpot] Contact search failed: {e}")
            return SearchResult(found=False, error=str(e))
    
    def create_lead(self, mapped_data: Dict[str, Any]) -> CreateResult:
        """Create a new Contact in HubSpot."""
        logger.info("[HubSpot] Creating contact")
        
        try:
            # Transform values for HubSpot's strict picklist fields
            cleaned_data = self._transform_hubspot_values(mapped_data)
            
            contact_input = SimplePublicObjectInputForCreate(properties=cleaned_data)
            result = self.client.crm.contacts.basic_api.create(
                simple_public_object_input_for_create=contact_input
            )
            
            external_id = result.id
            logger.info(f"[HubSpot] Contact created: {external_id}")
            
            return CreateResult(
                success=True,
                external_id=external_id,
                raw_response={"id": result.id, "properties": result.properties}
            )
                
        except ApiException as e:
            error_msg = str(e)
            # Parse HubSpot error response
            if hasattr(e, 'body'):
                try:
                    import json
                    error_body = json.loads(e.body)
                    error_msg = error_body.get('message', str(e))
                except:
                    pass
            logger.error(f"[HubSpot] Create failed: {error_msg}")
            return CreateResult(success=False, error=error_msg)
        except Exception as e:
            logger.error(f"[HubSpot] Create contact failed: {e}")
            return CreateResult(success=False, error=str(e))
    
    def get_lead(self, external_id: str) -> Dict[str, Any]:
        """Get Contact by HubSpot ID."""
        logger.info(f"[HubSpot] Getting contact: {external_id}")
        
        try:
            result = self.client.crm.contacts.basic_api.get_by_id(
                contact_id=external_id,
                properties=["firstname", "lastname", "email", "phone", "company"]
            )
            return {"id": result.id, **result.properties}
        except Exception as e:
            logger.error(f"[HubSpot] Get contact failed: {e}")
            raise
    
    def delete_lead(self, external_id: str) -> bool:
        """Delete Contact by HubSpot ID (archives it)."""
        logger.info(f"[HubSpot] Archiving contact: {external_id}")
        
        try:
            self.client.crm.contacts.basic_api.archive(contact_id=external_id)
            logger.info(f"[HubSpot] Contact archived: {external_id}")
            return True
        except Exception as e:
            logger.error(f"[HubSpot] Archive contact failed: {e}")
            return False
    
    def _transform_hubspot_values(self, mapped_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transform TourSpark values to HubSpot-compatible values.
        Handles strict picklist fields that only accept specific values.
        """
        cleaned = mapped_data.copy()
        
        # Transform hs_analytics_source (Lead Source)
        if 'hs_analytics_source' in cleaned:
            source_value = str(cleaned['hs_analytics_source']).upper()
            
            # Map common sources to HubSpot values
            source_mapping = {
                'LUMALEASING': 'AI_REFERRALS',
                'LUMA': 'AI_REFERRALS',
                'WIDGET': 'AI_REFERRALS',
                'WEBSITE': 'DIRECT_TRAFFIC',
                'GOOGLE': 'ORGANIC_SEARCH',
                'FACEBOOK': 'SOCIAL_MEDIA',
                'INSTAGRAM': 'SOCIAL_MEDIA',
                'REFERRAL': 'REFERRALS',
                'EMAIL': 'EMAIL_MARKETING',
            }
            
            # Try to find a match
            matched = False
            for key, hubspot_value in source_mapping.items():
                if key in source_value:
                    cleaned['hs_analytics_source'] = hubspot_value
                    matched = True
                    break
            
            if not matched:
                # Default to OTHER_CAMPAIGNS if no match
                cleaned['hs_analytics_source'] = 'OTHER_CAMPAIGNS'
        
        # Transform lifecyclestage (Lead Status)
        if 'lifecyclestage' in cleaned:
            status_value = str(cleaned['lifecyclestage']).lower()
            
            # Map TourSpark statuses to HubSpot lifecycle stages
            status_mapping = {
                'new': 'lead',
                'contacted': 'lead',
                'tour_booked': 'opportunity',
                'tour_scheduled': 'opportunity',
                'leased': 'customer',
                'lost': 'other',
            }
            
            cleaned['lifecyclestage'] = status_mapping.get(status_value, 'lead')
        
        # Transform hs_lead_status if mapped
        if 'hs_lead_status' in cleaned:
            status_value = str(cleaned['hs_lead_status']).lower()
            
            # Map to HubSpot lead status values
            lead_status_mapping = {
                'new': 'NEW',
                'contacted': 'OPEN',
                'tour_booked': 'IN_PROGRESS',
                'leased': 'CONNECTED',
                'lost': 'UNQUALIFIED',
            }
            
            cleaned['hs_lead_status'] = lead_status_mapping.get(status_value, 'NEW')
        
        return cleaned

