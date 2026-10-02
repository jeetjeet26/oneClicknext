"""
CRM Integration API Router
Handles CRM connection, schema discovery, and lead push operations
"""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import logging
from dataclasses import asdict
from datetime import datetime, timezone

from utils.auth import verify_api_key
from utils.delivery_guard import require_delivery_enabled
from utils.supabase_client import get_supabase_client
from jobs.crm_schema_agent import (
    CRMSchemaAgent,
    create_fallback_mappings,
    get_tourspark_schema,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/crm", tags=["CRM Integration"])


# ============================================
# Request/Response Models
# ============================================

class TestConnectionRequest(BaseModel):
    """Request to test CRM connection"""
    crm_type: str = Field(..., description="CRM type: yardi, realpage, salesforce, hubspot, lasso")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")


class DiscoverSchemaRequest(BaseModel):
    """Request to discover CRM schema and generate mappings"""
    property_id: str = Field(..., description="Property UUID")
    crm_type: str = Field(..., description="CRM type: yardi, realpage, salesforce, hubspot, lasso")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")


class SearchLeadRequest(BaseModel):
    """Request to search for existing lead in CRM"""
    property_id: str = Field(..., description="Property UUID")
    crm_type: str = Field(..., description="CRM type")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")
    email: str = Field(..., description="Email to search")
    phone: Optional[str] = Field(None, description="Phone to search")


class PushLeadRequest(BaseModel):
    """Request to push a lead to CRM"""
    property_id: str = Field(..., description="Property UUID")
    lead_id: str = Field(..., description="TourSpark lead UUID")
    crm_type: str = Field(..., description="CRM type")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")
    lead_data: Dict[str, Any] = Field(..., description="Lead data with TourSpark field names")
    field_mapping: Dict[str, str] = Field(..., description="Field mapping {tourspark: crm}")


class AddLeadNoteRequest(BaseModel):
    """Request to attach a note to an existing CRM lead"""
    property_id: str = Field(..., description="Property UUID")
    lead_id: str = Field(..., description="TourSpark lead UUID")
    crm_type: str = Field(..., description="CRM type")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")
    external_id: str = Field(..., description="CRM's ID for the lead")
    note: str = Field(..., min_length=1, description="Note body to attach")


class SaveMappingRequest(BaseModel):
    """Request to save validated field mapping"""
    property_id: str = Field(..., description="Property UUID")
    crm_type: str = Field(..., description="CRM type")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")
    field_mapping: Dict[str, Any] = Field(..., description="Field mapping configuration")
    validated: bool = Field(False, description="Whether mapping has been validated via test sync")


class ValidateMappingRequest(BaseModel):
    """Request to validate field mapping with test sync"""
    property_id: str = Field(..., description="Property UUID")
    crm_type: str = Field(..., description="CRM type")
    credentials: Dict[str, Any] = Field(..., description="CRM API credentials")
    field_mapping: Dict[str, str] = Field(..., description="Field mapping to validate")


# ============================================
# Helper Functions
# ============================================

def get_crm_adapter(crm_type: str, credentials: Dict[str, Any]):
    """
    Factory function to get the appropriate CRM adapter.
    
    Args:
        crm_type: Type of CRM
        credentials: API credentials
        
    Returns:
        CRM adapter instance
        
    Raises:
        HTTPException if CRM type is not supported
    """
    crm_type_lower = crm_type.lower()
    
    if crm_type_lower == 'yardi':
        from connectors.crm_adapters.yardi_adapter import YardiAdapter
        return YardiAdapter(credentials)
    elif crm_type_lower == 'realpage':
        from connectors.crm_adapters.realpage_adapter import RealPageAdapter
        return RealPageAdapter(credentials)
    elif crm_type_lower == 'salesforce':
        from connectors.crm_adapters.verified_rest import SalesforceAdapter
        return SalesforceAdapter(credentials)
    elif crm_type_lower == 'hubspot':
        from connectors.crm_adapters.verified_rest import HubSpotAdapter
        return HubSpotAdapter(credentials)
    elif crm_type_lower == 'lasso':
        from connectors.crm_adapters.lasso_adapter import LassoAdapter
        return LassoAdapter(credentials)
    else:
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported CRM type: {crm_type}. Supported: yardi, realpage, salesforce, hubspot, lasso"
        )


async def get_learned_patterns(crm_type: str) -> List[Dict[str, Any]]:
    """Fetch learned mapping patterns from database."""
    try:
        supabase = get_supabase_client()
        result = supabase.table('field_mapping_suggestions') \
            .select('*') \
            .eq('crm_type', crm_type.lower()) \
            .gte('times_accepted', 2) \
            .order('times_accepted', desc=True) \
            .limit(20) \
            .execute()
        
        return result.data or []
    except Exception as e:
        logger.warning(f"Could not fetch learned patterns: {e}")
        return []


# ============================================
# API Endpoints
# ============================================

@router.post("/test-connection")
async def test_connection(
    request: TestConnectionRequest,
    api_key: str = Depends(verify_api_key)
):
    raise HTTPException(status_code=409, detail="Use the saved CRM setup and mapping review workflow.")


@router.post("/discover-schema")
async def discover_schema(
    request: DiscoverSchemaRequest,
    api_key: str = Depends(verify_api_key)
):
    raise HTTPException(status_code=409, detail="Use the saved CRM setup and mapping review workflow.")


@router.post("/search-lead")
async def search_lead(
    request: SearchLeadRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Check if lead already exists in CRM by email/phone.
    Used for duplicate prevention before creating new leads.
    """
    logger.info("[CRM] Searching scoped CRM records")
    
    try:
        adapter = get_crm_adapter(request.crm_type, request.credentials)
        result = adapter.search_lead(request.email, request.phone)
        if result.error or (result.found and not result.external_id):
            return {"success": False, "found": False, "error": "CRM duplicate check was not confirmed"}
        
        return {
            "success": True,
            "found": result.found,
            "external_id": result.external_id,
            "match_type": result.match_type,
            "existing_data": result.existing_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CRM] Lead search failed: {e}")
        return {
            "success": False,
            "found": False,
            "error": str(e)
        }


@router.post("/push-lead")
async def push_lead(
    request: PushLeadRequest,
    api_key: str = Depends(verify_api_key)
):
    require_delivery_enabled()
    raise HTTPException(status_code=409, detail="Use a saved, approved CRM transfer identity. Direct lead, note and bulk writes are retired.")


@router.post("/add-lead-note")
async def add_lead_note(
    request: AddLeadNoteRequest,
    api_key: str = Depends(verify_api_key)
):
    require_delivery_enabled()
    raise HTTPException(status_code=409, detail="Use a saved, approved CRM transfer identity. Direct lead, note and bulk writes are retired.")


@router.post("/validate-mapping")
async def validate_mapping(request: ValidateMappingRequest, api_key: str = Depends(verify_api_key)):
    """Creating a test record requires a saved, recoverable provider verification operation."""
    require_delivery_enabled()
    raise HTTPException(status_code=409, detail="A saved provider verification operation is required; local mapping review does not create CRM records.")


@router.post("/save-mapping")
async def save_mapping(request: SaveMappingRequest, api_key: str = Depends(verify_api_key)):
    """Legacy saves cannot assert provider readiness or bypass recorded review."""
    raise HTTPException(status_code=409, detail="Use the versioned CRM mapping review workspace.")


@router.get("/learned-patterns/{crm_type}")
async def get_learned_patterns_endpoint(
    crm_type: str,
    api_key: str = Depends(verify_api_key)
):
    raise HTTPException(status_code=409, detail="Use property-scoped saved field discovery and reviewed mappings.")


@router.get("/tourspark-schema")
async def get_tourspark_schema_endpoint():
    """
    Get the TourSpark canonical schema.
    Shows what fields need to be mapped.
    """
    return {
        "success": True,
        "schema": get_tourspark_schema()
    }


class RecordCorrectionRequest(BaseModel):
    """Request to record a user's mapping correction"""
    crm_type: str = Field(..., description="CRM type")
    tourspark_field: str = Field(..., description="TourSpark field name")
    suggested_crm_field: str = Field(..., description="AI's suggested CRM field")
    final_crm_field: str = Field(..., description="User's final choice")


@router.post("/record-correction")
async def record_mapping_correction(
    request: RecordCorrectionRequest,
    api_key: str = Depends(verify_api_key)
):
    raise HTTPException(status_code=409, detail="Use the saved CRM setup and mapping review workflow.")


class CRMSyncStatsRequest(BaseModel):
    """Request for CRM sync statistics"""
    property_id: Optional[str] = Field(None, description="Filter by property")
    date_from: Optional[str] = Field(None, description="Start date (ISO format)")
    date_to: Optional[str] = Field(None, description="End date (ISO format)")


@router.post("/sync-stats")
async def get_crm_sync_stats(
    request: CRMSyncStatsRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Get CRM sync statistics for monitoring dashboard.
    """
    logger.info(f"[CRM] Getting sync stats for property: {request.property_id}")
    
    try:
        supabase = get_supabase_client()
        
        # Build query
        query = supabase.table('leads').select('id, crm_sync_status, crm_synced_at, property_id')
        
        if request.property_id:
            query = query.eq('property_id', request.property_id)
        
        # Filter by sync status to get only leads that have been attempted
        query = query.neq('crm_sync_status', 'pending')
        
        if request.date_from:
            query = query.gte('crm_synced_at', request.date_from)
        if request.date_to:
            query = query.lte('crm_synced_at', request.date_to)
        
        result = query.execute()
        leads = result.data or []
        
        # Calculate stats
        stats = {
            'total_synced': len(leads),
            'created': len([l for l in leads if l.get('crm_sync_status') == 'created']),
            'linked': len([l for l in leads if l.get('crm_sync_status') == 'linked']),
            'failed': len([l for l in leads if l.get('crm_sync_status') == 'failed']),
            'skipped': len([l for l in leads if l.get('crm_sync_status') == 'skipped']),
        }
        
        # Calculate success rate
        total_attempts = stats['created'] + stats['linked'] + stats['failed']
        stats['success_rate'] = (
            round((stats['created'] + stats['linked']) / total_attempts * 100, 1)
            if total_attempts > 0 else 100.0
        )
        
        return {
            "success": True,
            "stats": stats
        }
        
    except Exception as e:
        logger.error(f"[CRM] Get sync stats failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/sync-history/{property_id}")
async def get_crm_sync_history(
    property_id: str,
    limit: int = 50,
    api_key: str = Depends(verify_api_key)
):
    """
    Get recent CRM sync history for a property.
    Shows individual lead sync results.
    """
    logger.info(f"[CRM] Getting sync history for property: {property_id}")
    
    try:
        supabase = get_supabase_client()
        
        result = supabase.table('leads').select(
            'id, first_name, last_name, email, crm_sync_status, crm_synced_at, external_crm_id, crm_sync_error'
        ).eq('property_id', property_id).neq(
            'crm_sync_status', 'pending'
        ).order('crm_synced_at', desc=True).limit(limit).execute()
        
        return {
            "success": True,
            "history": result.data or [],
            "count": len(result.data or [])
        }
        
    except Exception as e:
        logger.error(f"[CRM] Get sync history failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }


class BulkSyncRequest(BaseModel):
    """Request to bulk sync existing leads to CRM"""
    property_id: str = Field(..., description="Property UUID")
    lead_ids: List[str] = Field(..., description="List of lead IDs to sync")


@router.post("/bulk-sync")
async def bulk_sync_leads(
    request: BulkSyncRequest,
    background_tasks: BackgroundTasks,
    api_key: str = Depends(verify_api_key)
):
    require_delivery_enabled()
    raise HTTPException(status_code=409, detail="Use a saved, approved CRM transfer identity. Direct lead, note and bulk writes are retired.")


class SavedSetupRequest(BaseModel):
    operation_id: str = Field(..., pattern=r"^[0-9a-fA-F-]{36}$")

@router.post("/setup-operation")
async def saved_setup_operation(request: SavedSetupRequest, api_key: str = Depends(verify_api_key)):
    from starlette.concurrency import run_in_threadpool
    from jobs.crm_setup import run_setup_operation
    return await run_in_threadpool(run_setup_operation, request.operation_id, get_crm_adapter)


class SavedDeliveryRequest(BaseModel):
    handoff_id: str = Field(..., pattern=r"^[0-9a-fA-F-]{36}$")

@router.post("/delivery-operation")
async def saved_delivery_operation(request: SavedDeliveryRequest, api_key: str = Depends(verify_api_key)):
    require_delivery_enabled()
    from starlette.concurrency import run_in_threadpool
    from jobs.crm_delivery import run_crm_handoff
    return await run_in_threadpool(run_crm_handoff, request.handoff_id, get_crm_adapter)


class SavedReconciliationRequest(BaseModel):
    check_id: str = Field(..., pattern=r"^[0-9a-fA-F-]{36}$")

@router.post("/reconciliation-operation")
async def saved_reconciliation_operation(request: SavedReconciliationRequest, api_key: str = Depends(verify_api_key)):
    from starlette.concurrency import run_in_threadpool
    from jobs.crm_reconciliation import run_crm_reconciliation
    return await run_in_threadpool(run_crm_reconciliation, request.check_id, get_crm_adapter)


class SavedQualificationRequest(BaseModel):
    operation_id: str = Field(..., pattern=r"^[0-9a-fA-F-]{36}$")

@router.post("/qualification-operation")
async def saved_qualification_operation(request: SavedQualificationRequest, api_key: str = Depends(verify_api_key)):
    from starlette.concurrency import run_in_threadpool
    from jobs.crm_qualification import run_crm_qualification
    return await run_in_threadpool(run_crm_qualification, request.operation_id, get_crm_adapter)
