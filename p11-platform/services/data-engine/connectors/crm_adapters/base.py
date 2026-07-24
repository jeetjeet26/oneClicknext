"""
Base CRM Adapter
Abstract base class for all CRM/PMS integrations
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from enum import Enum


class FieldType(str, Enum):
    """Standard field types across CRMs"""
    STRING = "string"
    EMAIL = "email"
    PHONE = "phone"
    DATE = "date"
    DATETIME = "datetime"
    NUMBER = "number"
    BOOLEAN = "boolean"
    PICKLIST = "picklist"
    TEXT = "text"


@dataclass
class CRMField:
    """Represents a field in a CRM schema"""
    name: str
    label: str
    type: FieldType
    required: bool = False
    max_length: Optional[int] = None
    picklist_values: List[str] = field(default_factory=list)
    custom_field: bool = False
    description: str = ""


@dataclass
class CRMSchema:
    """Represents a CRM's schema for a specific object type"""
    crm_type: str
    api_version: str
    object_name: str
    object_label: str
    fields: List[CRMField]


@dataclass
class SearchResult:
    """Result of searching for a lead in the CRM"""
    found: bool
    external_id: Optional[str] = None
    match_type: Optional[str] = None  # 'email', 'phone', or 'both'
    existing_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@dataclass
class CreateResult:
    """Result of creating a lead in the CRM"""
    success: bool
    external_id: Optional[str] = None
    error: Optional[str] = None
    raw_response: Optional[Dict[str, Any]] = None


@dataclass
class ConnectionResult:
    """Result of testing CRM connection"""
    success: bool
    message: str = ""
    error: Optional[str] = None
    api_version: Optional[str] = None


class BaseCRMAdapter(ABC):
    """
    Abstract base class for CRM adapters.
    
    All CRM implementations (Yardi, RealPage, Salesforce, HubSpot) 
    must implement these methods.
    """
    
    def __init__(self, credentials: Dict[str, Any]):
        """
        Initialize adapter with credentials.
        
        Args:
            credentials: Dictionary containing API credentials
                - api_endpoint: Base URL for API
                - api_key: API key or token
                - Additional CRM-specific fields
        """
        self.credentials = credentials
        self._validate_credentials()
    
    @abstractmethod
    def _validate_credentials(self) -> None:
        """Validate required credentials are present. Raise ValueError if not."""
        pass
    
    @abstractmethod
    def test_connection(self) -> ConnectionResult:
        """
        Test API connection with provided credentials.
        
        Returns:
            ConnectionResult with success status
        """
        pass
    
    @abstractmethod
    def get_schema(self) -> CRMSchema:
        """
        Introspect CRM schema to discover available fields.
        
        Returns:
            CRMSchema with fields for the lead/prospect object
        """
        pass
    
    @abstractmethod
    def search_lead(self, email: str, phone: Optional[str] = None) -> SearchResult:
        """
        Search for existing lead in CRM by email and/or phone.
        
        Args:
            email: Email address to search
            phone: Optional phone number to search
            
        Returns:
            SearchResult indicating if lead was found
        """
        pass
    
    @abstractmethod
    def create_lead(self, mapped_data: Dict[str, Any]) -> CreateResult:
        """
        Create a new lead in the CRM.
        
        Args:
            mapped_data: Lead data with CRM field names (already mapped)
            
        Returns:
            CreateResult with external_id if successful
        """
        pass
    
    @abstractmethod
    def get_lead(self, external_id: str) -> Dict[str, Any]:
        """
        Get lead by external CRM ID.
        
        Args:
            external_id: The CRM's ID for the lead
            
        Returns:
            Dictionary with lead data
        """
        pass
    
    @abstractmethod
    def delete_lead(self, external_id: str) -> bool:
        """
        Delete lead by external CRM ID (for test validation cleanup).
        
        Args:
            external_id: The CRM's ID for the lead
            
        Returns:
            True if deleted successfully
        """
        pass
    
    def add_note(self, external_id: str, note: str) -> CreateResult:
        """
        Attach a note to an existing lead in the CRM.

        Adapters that support post-creation notes (e.g. Lasso registrant
        notes) override this. The default reports the capability as
        unsupported so callers can skip gracefully.
        """
        return CreateResult(
            success=False,
            error="Adding notes is not supported for this CRM type",
        )

    def apply_mapping(self, tourspark_data: Dict[str, Any], mapping: Dict[str, str]) -> Dict[str, Any]:
        """
        Apply field mapping to convert TourSpark data to CRM format.
        
        Args:
            tourspark_data: Lead data with TourSpark field names
            mapping: Dictionary of {tourspark_field: crm_field}
            
        Returns:
            Dictionary with CRM field names
        """
        crm_data = {}
        for ts_field, crm_field in mapping.items():
            if ts_field in tourspark_data and tourspark_data[ts_field] is not None:
                crm_data[crm_field] = tourspark_data[ts_field]
        return crm_data


# TourSpark canonical schema - the source of truth for field mapping
TOURSPARK_SCHEMA = {
    "fields": [
        {
            "name": "first_name",
            "label": "First Name",
            "type": "string",
            "required": True,
            "description": "Lead's first name"
        },
        {
            "name": "last_name",
            "label": "Last Name",
            "type": "string",
            "required": True,
            "description": "Lead's last name"
        },
        {
            "name": "email",
            "label": "Email",
            "type": "email",
            "required": True,
            "description": "Primary email address"
        },
        {
            "name": "phone",
            "label": "Phone",
            "type": "phone",
            "required": False,
            "description": "Primary phone number (mobile or work)"
        },
        {
            "name": "source",
            "label": "Lead Source",
            "type": "string",
            "required": False,
            "description": "Where the lead came from (e.g., LumaLeasing Widget, Website, Walk-in)"
        },
        {
            "name": "status",
            "label": "Status",
            "type": "string",
            "required": True,
            "description": "Lead lifecycle stage (new, contacted, tour_booked, etc.)"
        },
        {
            "name": "move_in_date",
            "label": "Move-in Date",
            "type": "date",
            "required": False,
            "description": "Desired move-in date"
        },
        {
            "name": "bedrooms",
            "label": "Bedrooms",
            "type": "string",
            "required": False,
            "description": "Desired bedroom count (Studio, 1BR, 2BR, etc.)"
        },
        {
            "name": "notes",
            "label": "Notes",
            "type": "text",
            "required": False,
            "description": "Additional information and conversation summary"
        },
    ]
}

