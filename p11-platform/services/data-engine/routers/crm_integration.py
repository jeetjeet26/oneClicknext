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
        from connectors.crm_adapters.salesforce_adapter import SalesforceAdapter
        return SalesforceAdapter(credentials)
    elif crm_type_lower == 'hubspot':
        from connectors.crm_adapters.hubspot_adapter import HubSpotAdapter
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
    """
    Test CRM API connection with provided credentials.
    Quick validation before running full discovery.
    """
    logger.info(f"[CRM] Testing connection for {request.crm_type}")
    
    try:
        adapter = get_crm_adapter(request.crm_type, request.credentials)
        result = adapter.test_connection()
        
        return {
            "success": result.success,
            "message": result.message,
            "api_version": result.api_version,
            "error": result.error
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CRM] Connection test failed: {e}")
        return {
            "success": False,
            "message": "Connection test failed",
            "error": str(e)
        }


@router.post("/discover-schema")
async def discover_schema(
    request: DiscoverSchemaRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    AI-powered schema discovery and field mapping.
    
    1. Connects to CRM and introspects schema
    2. Uses Claude to intelligently map fields
    3. Returns mappings with confidence scores for user review
    """
    logger.info(f"[CRM] Starting schema discovery for {request.crm_type}, property {request.property_id}")
    
    try:
        # Get CRM adapter and introspect schema
        adapter = get_crm_adapter(request.crm_type, request.credentials)
        
        # Test connection first
        conn_result = adapter.test_connection()
        if not conn_result.success:
            return {
                "success": False,
                "error": f"Connection failed: {conn_result.error}"
            }
        
        # Get CRM schema
        crm_schema = adapter.get_schema()
        schema_dict = {
            "crm_type": crm_schema.crm_type,
            "api_version": crm_schema.api_version,
            "objects": [{
                "name": crm_schema.object_name,
                "label": crm_schema.object_label,
                "fields": [asdict(f) for f in crm_schema.fields]
            }]
        }
        
        # Get learned patterns for this CRM type
        learned_patterns = await get_learned_patterns(request.crm_type)
        
        try:
            # Run AI agent to generate mappings when configured.
            agent = CRMSchemaAgent()
            mapping_result = agent.discover_and_map(
                crm_type=request.crm_type,
                crm_schema=schema_dict,
                learned_patterns=learned_patterns
            )

            if not mapping_result.success:
                logger.warning(
                    "[CRM] AI schema mapping failed, using fallback mappings: %s",
                    mapping_result.error,
                )
                mappings = [asdict(m) for m in create_fallback_mappings(schema_dict)]
                agent_reasoning = (
                    "AI schema mapping was unavailable, so these mappings were generated "
                    "from known CRM field names. Review them before saving."
                )
            else:
                mappings = [asdict(m) for m in mapping_result.mappings]
                agent_reasoning = mapping_result.agent_reasoning
        except Exception as mapping_error:
            logger.warning(
                "[CRM] AI schema mapping unavailable, using fallback mappings: %s",
                mapping_error,
            )
            mappings = [asdict(m) for m in create_fallback_mappings(schema_dict)]
            agent_reasoning = (
                "AI schema mapping was unavailable, so these mappings were generated "
                "from known CRM field names. Review them before saving."
            )
        
        logger.info(f"[CRM] Schema discovery complete: {len(mappings)} field mappings generated")
        
        return {
            "success": True,
            "schema": schema_dict,
            "mappings": mappings,
            "agent_reasoning": agent_reasoning,
            "tourspark_schema": get_tourspark_schema()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CRM] Schema discovery failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search-lead")
async def search_lead(
    request: SearchLeadRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Check if lead already exists in CRM by email/phone.
    Used for duplicate prevention before creating new leads.
    """
    logger.info(f"[CRM] Searching for lead: {request.email}")
    
    try:
        adapter = get_crm_adapter(request.crm_type, request.credentials)
        result = adapter.search_lead(request.email, request.phone)
        
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
    """
    Push a lead to CRM.
    
    1. Applies field mapping to convert TourSpark data to CRM format
    2. Checks if lead already exists (duplicate prevention)
    3. Creates new lead or returns existing ID
    """
    logger.info(f"[CRM] Pushing lead {request.lead_id} to {request.crm_type}")
    
    try:
        adapter = get_crm_adapter(request.crm_type, request.credentials)
        
        # Check for existing lead first
        email = request.lead_data.get('email')
        phone = request.lead_data.get('phone')
        
        if email:
            search_result = adapter.search_lead(email, phone)
            
            if search_result.found:
                logger.info(f"[CRM] Lead already exists: {search_result.external_id}")
                return {
                    "success": True,
                    "action": "linked",
                    "external_id": search_result.external_id,
                    "message": f"Lead already exists in CRM (matched by {search_result.match_type})"
                }
        
        # Apply field mapping
        mapped_data = adapter.apply_mapping(request.lead_data, request.field_mapping)
        
        # Create new lead
        create_result = adapter.create_lead(mapped_data)
        
        if create_result.success:
            logger.info(f"[CRM] Lead created: {create_result.external_id}")
            return {
                "success": True,
                "action": "created",
                "external_id": create_result.external_id,
                "message": "Lead created successfully in CRM"
            }
        else:
            logger.error(f"[CRM] Lead creation failed: {create_result.error}")
            return {
                "success": False,
                "action": "failed",
                "error": create_result.error
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CRM] Lead push failed: {e}", exc_info=True)
        return {
            "success": False,
            "action": "failed",
            "error": str(e)
        }


@router.post("/validate-mapping")
async def validate_mapping(
    request: ValidateMappingRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Validate field mapping by creating a test record.
    Creates, reads, and deletes a test lead to verify mapping works.
    """
    logger.info(f"[CRM] Validating mapping for {request.crm_type}")
    
    try:
        adapter = get_crm_adapter(request.crm_type, request.credentials)

        if (
            request.crm_type.lower() == "lasso"
            and request.credentials.get("client_id")
            and request.credentials.get("project_id")
        ):
            conn_result = adapter.test_connection()
            if not conn_result.success:
                return {
                    "valid": False,
                    "step_failed": "connection",
                    "errors": [conn_result.error],
                    "warnings": [],
                }

            return {
                "valid": True,
                "errors": [],
                "warnings": [
                    "Lasso public registration keys are write-only; skipped create/read/delete test sync."
                ],
                "message": "Lasso public registration mapping accepted",
            }
        
        # Create test lead data - only basic required fields to avoid picklist validation issues
        test_data = {
            "first_name": "TourSpark",
            "last_name": "Test",
            "email": f"tourspark.test.{request.property_id[:8]}@example.com",
            "phone": "555-000-0000",
        }
        
        # Apply mapping - only for fields present in test data
        mapped_data = {}
        for ts_field, crm_field in request.field_mapping.items():
            if ts_field in test_data and test_data[ts_field]:
                mapped_data[crm_field] = test_data[ts_field]
        
        # Step 1: Create test lead
        create_result = adapter.create_lead(mapped_data)
        
        if not create_result.success:
            return {
                "valid": False,
                "step_failed": "create",
                "errors": [create_result.error],
                "warnings": []
            }
        
        test_id = create_result.external_id
        logger.info(f"[CRM] Test lead created: {test_id}")
        
        # Step 2: Read it back
        try:
            read_data = adapter.get_lead(test_id)
            if not read_data:
                return {
                    "valid": False,
                    "step_failed": "read",
                    "errors": ["Could not read test lead back from CRM"],
                    "warnings": [],
                    "test_id": test_id
                }
        except Exception as e:
            return {
                "valid": False,
                "step_failed": "read",
                "errors": [str(e)],
                "warnings": [],
                "test_id": test_id
            }
        
        # Step 3: Delete test record
        try:
            deleted = adapter.delete_lead(test_id)
            if not deleted:
                logger.warning(f"[CRM] Could not delete test lead {test_id}")
        except Exception as e:
            logger.warning(f"[CRM] Error deleting test lead: {e}")
        
        logger.info(f"[CRM] Mapping validation successful")
        
        return {
            "valid": True,
            "test_id": test_id,
            "errors": [],
            "warnings": [],
            "message": "Field mapping validated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CRM] Mapping validation failed: {e}", exc_info=True)
        return {
            "valid": False,
            "step_failed": "unknown",
            "errors": [str(e)],
            "warnings": []
        }


@router.post("/save-mapping")
async def save_mapping(
    request: SaveMappingRequest,
    api_key: str = Depends(verify_api_key)
):
    """
    Save field mapping to database after user review.
    Updates integration_credentials table.
    """
    logger.info(f"[CRM] Saving mapping for property {request.property_id}")
    
    try:
        supabase = get_supabase_client()
        mapping_validated_at = (
            datetime.now(timezone.utc).isoformat() if request.validated else None
        )
        
        # Upsert to integration_credentials (including credentials)
        result = supabase.table('integration_credentials').upsert({
            'property_id': request.property_id,
            'platform': request.crm_type.lower(),
            'credentials': request.credentials,
            'field_mapping': request.field_mapping,
            'mapping_validated': request.validated,
            'mapping_validated_at': mapping_validated_at,
            'status': 'connected' if request.validated else 'pending'
        }, on_conflict='property_id,platform').execute()
        
        return {
            "success": True,
            "message": "Field mapping saved successfully"
        }
        
    except Exception as e:
        logger.error(f"[CRM] Save mapping failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/learned-patterns/{crm_type}")
async def get_learned_patterns_endpoint(
    crm_type: str,
    api_key: str = Depends(verify_api_key)
):
    """
    Get learned mapping patterns for a CRM type.
    Shows what other properties have successfully mapped.
    """
    patterns = await get_learned_patterns(crm_type)
    
    return {
        "success": True,
        "crm_type": crm_type,
        "patterns": patterns,
        "count": len(patterns)
    }


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
    """
    Record a user's mapping correction for the learning system.
    This improves future AI suggestions.
    """
    logger.info(f"[CRM] Recording correction: {request.tourspark_field} -> {request.final_crm_field}")
    
    try:
        supabase = get_supabase_client()
        
        # Call the database function to record the correction
        supabase.rpc('record_mapping_correction', {
            'p_crm_type': request.crm_type.lower(),
            'p_tourspark_field': request.tourspark_field,
            'p_suggested_crm_field': request.suggested_crm_field,
            'p_final_crm_field': request.final_crm_field
        }).execute()
        
        return {
            "success": True,
            "message": "Correction recorded for learning system"
        }
        
    except Exception as e:
        logger.error(f"[CRM] Record correction failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }


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
    """
    Bulk sync existing leads to CRM.
    Runs in background and returns job tracking info.
    """
    logger.info(f"[CRM] Bulk sync requested for {len(request.lead_ids)} leads")
    
    try:
        supabase = get_supabase_client()
        
        # Get CRM integration config
        integration_result = supabase.table('integration_credentials').select(
            'platform, credentials, field_mapping, mapping_validated'
        ).eq('property_id', request.property_id).in_(
            'platform', ['yardi', 'realpage', 'salesforce', 'hubspot', 'lasso']
        ).eq('status', 'connected').single().execute()
        
        if not integration_result.data:
            return {
                "success": False,
                "error": "No CRM integration configured for this property"
            }
        
        integration = integration_result.data
        
        if not integration['mapping_validated']:
            return {
                "success": False,
                "error": "CRM mapping not validated. Please validate first."
            }
        
        # Get leads to sync
        leads_result = supabase.table('leads').select(
            'id, first_name, last_name, email, phone, source, status, move_in_date, bedrooms, notes, external_crm_id'
        ).eq('property_id', request.property_id).in_('id', request.lead_ids).execute()
        
        leads = leads_result.data or []
        
        if not leads:
            return {
                "success": False,
                "error": "No leads found to sync"
            }
        
        # Process in background
        async def process_bulk_sync():
            adapter = get_crm_adapter(integration['platform'], integration['credentials'])
            results = {
                "created": 0,
                "linked": 0,
                "failed": 0,
                "skipped": 0
            }
            
            for lead in leads:
                try:
                    # Skip if already synced
                    if lead.get('external_crm_id'):
                        logger.info(f"[CRM] Lead {lead['id']} already synced, skipping")
                        results["skipped"] += 1
                        continue
                    
                    # Search for existing (even with no/invalid email, try phone)
                    email = lead.get('email', '').strip()
                    phone = lead.get('phone', '').strip() if lead.get('phone') else None
                    
                    logger.info(f"[CRM] Processing lead {lead['id']}: {lead.get('first_name')} {lead.get('last_name')} - email: '{email}', phone: '{phone}'")
                    
                    search_result = adapter.search_lead(email if email else '', phone)
                    logger.info(f"[CRM] Search result: found={search_result.found}, id={search_result.external_id}")
                    
                    if search_result.found:
                        # Link to existing
                        supabase.table('leads').update({
                            'external_crm_id': search_result.external_id,
                            'crm_sync_status': 'linked',
                            'crm_synced_at': 'now()',
                        }).eq('id', lead['id']).execute()
                        
                        results["linked"] += 1
                        logger.info(f"[CRM] Linked lead {lead['id']} to existing CRM record")
                        continue
                    
                    # Create new lead in CRM
                    lead_data = {
                        'first_name': lead.get('first_name'),
                        'last_name': lead.get('last_name'),
                        'email': lead.get('email'),
                        'phone': lead.get('phone'),
                        'source': lead.get('source'),
                        'status': lead.get('status'),
                        'move_in_date': lead.get('move_in_date'),
                        'bedrooms': lead.get('bedrooms'),
                        'notes': lead.get('notes'),
                    }
                    
                    # Apply mapping
                    mapped_data = adapter.apply_mapping(lead_data, integration['field_mapping'])
                    
                    # Create in CRM
                    create_result = adapter.create_lead(mapped_data)
                    
                    if create_result.success:
                        supabase.table('leads').update({
                            'external_crm_id': create_result.external_id,
                            'crm_sync_status': 'created',
                            'crm_synced_at': 'now()',
                        }).eq('id', lead['id']).execute()
                        
                        results["created"] += 1
                        logger.info(f"[CRM] Created lead {lead['id']} in CRM: {create_result.external_id}")
                    else:
                        supabase.table('leads').update({
                            'crm_sync_status': 'failed',
                            'crm_sync_error': create_result.error,
                        }).eq('id', lead['id']).execute()
                        
                        results["failed"] += 1
                        logger.error(f"[CRM] Failed to create lead {lead['id']}: {create_result.error}")
                
                except Exception as e:
                    logger.error(f"[CRM] Error syncing lead {lead['id']}: {e}")
                    results["failed"] += 1
                    
                    supabase.table('leads').update({
                        'crm_sync_status': 'failed',
                        'crm_sync_error': str(e),
                    }).eq('id', lead['id']).execute()
            
            logger.info(f"[CRM] Bulk sync complete: {results}")
        
        background_tasks.add_task(process_bulk_sync)
        
        return {
            "success": True,
            "message": f"Bulk sync started for {len(leads)} leads",
            "total": len(leads)
        }
        
    except Exception as e:
        logger.error(f"[CRM] Bulk sync failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

