"""
Salesforce CRM Adapter
Uses simple-salesforce for Salesforce REST API
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
    from simple_salesforce import Salesforce, SalesforceAuthenticationFailed
    SALESFORCE_AVAILABLE = True
except ImportError:
    SALESFORCE_AVAILABLE = False
    logger.warning("simple-salesforce not installed. Install with: pip install simple-salesforce")


class SalesforceAdapter(BaseCRMAdapter):
    """
    Salesforce REST API adapter using simple-salesforce.
    
    Supports:
    - Lead object CRUD
    - Schema introspection via describe()
    - SOQL queries for search
    
    Credentials required:
    - username: Salesforce username
    - password: Salesforce password
    - security_token: Salesforce security token
    - domain: 'login' (production) or 'test' (sandbox)
    
    OR:
    - instance_url: Salesforce instance URL
    - access_token: OAuth access token
    """
    
    def __init__(self, credentials: Dict[str, Any]):
        if not SALESFORCE_AVAILABLE:
            raise ImportError("simple-salesforce not installed. Run: pip install simple-salesforce")
        
        super().__init__(credentials)
        self.sf: Optional[Salesforce] = None
        self._connect()
    
    def _validate_credentials(self) -> None:
        """Validate required credentials are present."""
        # Check for OAuth token auth
        if self.credentials.get('access_token') and self.credentials.get('instance_url'):
            return
        
        # Check for username/password auth
        required = ['username', 'password', 'security_token']
        missing = [f for f in required if not self.credentials.get(f)]
        if missing:
            raise ValueError(f"Missing required Salesforce credentials: {', '.join(missing)}")
    
    def _connect(self) -> None:
        """Establish connection to Salesforce."""
        if self.credentials.get('access_token') and self.credentials.get('instance_url'):
            # OAuth token auth
            self.sf = Salesforce(
                instance_url=self.credentials['instance_url'],
                session_id=self.credentials['access_token']
            )
        else:
            # Username/password auth
            self.sf = Salesforce(
                username=self.credentials['username'],
                password=self.credentials['password'],
                security_token=self.credentials['security_token'],
                domain=self.credentials.get('domain', 'login')
            )
    
    def test_connection(self) -> ConnectionResult:
        """Test API connection by querying user info."""
        logger.info("[Salesforce] Testing connection")
        
        try:
            # Limits is an authenticated read; a session token is not a user ID.
            self.sf.limits()

            return ConnectionResult(
                success=True,
                message="Successfully connected to Salesforce",
                api_version=self.sf.sf_version if hasattr(self.sf, 'sf_version') else 'v58.0'
            )
            
        except SalesforceAuthenticationFailed as e:
            return ConnectionResult(
                success=False,
                error=f"Authentication failed: {str(e)}"
            )
        except Exception as e:
            logger.error(f"[Salesforce] Connection test failed: {e}")
            return ConnectionResult(success=False, error=str(e))
    
    def get_schema(self) -> CRMSchema:
        """Get Salesforce Lead object schema via describe()."""
        logger.info("[Salesforce] Getting Lead schema")
        
        try:
            lead_desc = self.sf.Lead.describe()
            fields = []
            
            type_map = {
                'string': FieldType.STRING,
                'email': FieldType.EMAIL,
                'phone': FieldType.PHONE,
                'date': FieldType.DATE,
                'datetime': FieldType.DATETIME,
                'double': FieldType.NUMBER,
                'currency': FieldType.NUMBER,
                'int': FieldType.NUMBER,
                'boolean': FieldType.BOOLEAN,
                'picklist': FieldType.PICKLIST,
                'multipicklist': FieldType.PICKLIST,
                'textarea': FieldType.TEXT,
                'reference': FieldType.STRING,
                'id': FieldType.STRING,
            }
            
            for field in lead_desc.get('fields', []):
                field_type = type_map.get(field.get('type', 'string'), FieldType.STRING)
                
                # Get picklist values
                picklist_values = []
                if field.get('picklistValues'):
                    picklist_values = [p['value'] for p in field['picklistValues'] if p.get('active')]
                
                fields.append(CRMField(
                    name=field['name'],
                    label=field.get('label', field['name']),
                    type=field_type,
                    required=not field.get('nillable', True) and field.get('createable', True),
                    max_length=field.get('length'),
                    picklist_values=picklist_values,
                    custom_field=field.get('custom', False),
                    description=field.get('inlineHelpText', '')
                ))
            
            return CRMSchema(
                crm_type="salesforce",
                api_version=self.sf.sf_version if hasattr(self.sf, 'sf_version') else 'v58.0',
                object_name="Lead",
                object_label="Lead",
                fields=fields,
                    evidence_source="provider_response"
            )
            
        except Exception as e:
            logger.error(f"[Salesforce] Schema fetch failed: {e}")
            return self._get_default_schema()
    
    def _get_default_schema(self) -> CRMSchema:
        """Return default Salesforce Lead schema."""
        return CRMSchema(
            crm_type="salesforce",
            api_version="default",
            object_name="Lead",
            object_label="Lead",
            fields=[
                CRMField(name="FirstName", label="First Name", type=FieldType.STRING, required=False),
                CRMField(name="LastName", label="Last Name", type=FieldType.STRING, required=True),
                CRMField(name="Company", label="Company", type=FieldType.STRING, required=True),
                CRMField(name="Email", label="Email", type=FieldType.EMAIL, required=False),
                CRMField(name="Phone", label="Phone", type=FieldType.PHONE, required=False),
                CRMField(name="MobilePhone", label="Mobile Phone", type=FieldType.PHONE, required=False),
                CRMField(name="LeadSource", label="Lead Source", type=FieldType.PICKLIST, required=False),
                CRMField(name="Status", label="Lead Status", type=FieldType.PICKLIST, required=True),
                CRMField(name="Description", label="Description", type=FieldType.TEXT, required=False),
                CRMField(name="Street", label="Street", type=FieldType.STRING, required=False),
                CRMField(name="City", label="City", type=FieldType.STRING, required=False),
                CRMField(name="State", label="State/Province", type=FieldType.STRING, required=False),
                CRMField(name="PostalCode", label="Zip/Postal Code", type=FieldType.STRING, required=False),
            ]
        )
    
    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """Search for existing Lead in Salesforce by email and/or phone."""
        logger.info(f"[Salesforce] Searching for lead: {email}")
        
        try:
            # Search by email
            query = f"SELECT Id, FirstName, LastName, Email, Phone FROM Lead WHERE Email = '{email}' LIMIT 1"
            result = self.sf.query(query)
            
            if result.get('totalSize', 0) > 0:
                record = result['records'][0]
                return SearchResult(
                    found=True,
                    external_id=record['Id'],
                    match_type="email",
                    existing_data=record
                )
            
            # Try phone search
            if phone:
                # Normalize phone for search
                phone_clean = ''.join(c for c in phone if c.isdigit())
                query = f"SELECT Id, FirstName, LastName, Email, Phone FROM Lead WHERE Phone LIKE '%{phone_clean[-10:]}%' LIMIT 1"
                result = self.sf.query(query)
                
                if result.get('totalSize', 0) > 0:
                    record = result['records'][0]
                    return SearchResult(
                        found=True,
                        external_id=record['Id'],
                        match_type="phone",
                        existing_data=record
                    )
            
            return SearchResult(found=False)
            
        except Exception as e:
            logger.error(f"[Salesforce] Lead search failed: {e}")
            return SearchResult(found=False, error=str(e))
    
    def create_lead(self, mapped_data: Dict[str, Any]) -> CreateResult:
        """Create a new Lead in Salesforce."""
        logger.info("[Salesforce] Creating lead")
        
        try:
            # Ensure required fields have defaults
            if 'Company' not in mapped_data:
                mapped_data['Company'] = 'Not Specified'
            if 'Status' not in mapped_data:
                mapped_data['Status'] = 'New'
            if 'LastName' not in mapped_data:
                mapped_data['LastName'] = 'Unknown'
            
            result = self.sf.Lead.create(mapped_data)
            
            if result.get('success'):
                external_id = result.get('id')
                logger.info(f"[Salesforce] Lead created: {external_id}")
                return CreateResult(
                    success=True,
                    external_id=external_id,
                    raw_response=result
                )
            else:
                errors = result.get('errors', [])
                error_msg = '; '.join([e.get('message', str(e)) for e in errors])
                logger.error(f"[Salesforce] Create failed: {error_msg}")
                return CreateResult(success=False, error=error_msg)
                
        except Exception as e:
            logger.error(f"[Salesforce] Create lead failed: {e}")
            return CreateResult(success=False, error=str(e))
    
    def get_lead(self, external_id: str) -> Dict[str, Any]:
        """Get Lead by Salesforce ID."""
        logger.info(f"[Salesforce] Getting lead: {external_id}")
        
        try:
            result = self.sf.Lead.get(external_id)
            return dict(result)
        except Exception as e:
            logger.error(f"[Salesforce] Get lead failed: {e}")
            raise
    
    def delete_lead(self, external_id: str) -> bool:
        """Delete Lead by Salesforce ID."""
        logger.info(f"[Salesforce] Deleting lead: {external_id}")
        
        try:
            self.sf.Lead.delete(external_id)
            logger.info(f"[Salesforce] Lead deleted: {external_id}")
            return True
        except Exception as e:
            logger.error(f"[Salesforce] Delete lead failed: {e}")
            return False

