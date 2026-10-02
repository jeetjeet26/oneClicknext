"""Tracked, idempotent acceptance of property marketing imports."""
import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from utils.auth import verify_service_key
from utils.supabase_client import get_supabase_client

router = APIRouter()
logger = logging.getLogger(__name__)
JOB_FIELDS = 'id,property_id,channels,date_range,status,records_imported,recovery_version,connection_ids'


class SyncMarketingRequest(BaseModel):
    property_id: UUID
    job_id: UUID = Field(default_factory=uuid4)
    channels: list[Literal['google_ads', 'meta_ads']] = Field(default_factory=lambda: ['google_ads', 'meta_ads'], min_length=1, max_length=2)
    connection_ids: list[UUID] | None = Field(default=None, min_length=1, max_length=100)
    date_range: Literal['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'] = 'LAST_7_DAYS'


def authorize(authorization: Optional[str] = Header(None)):
    verify_service_key(authorization)


def read_job(supabase, job_id: str):
    result = supabase.table('import_jobs').select(JOB_FIELDS).eq('id', job_id).limit(1).execute()
    if not isinstance(result.data, list):
        raise RuntimeError('Import job lookup was not confirmed')
    return result.data[0] if result.data else None


def accepted_job(job, request: SyncMarketingRequest, reused: bool):
    if (job.get('id') != str(request.job_id) or job.get('property_id') != str(request.property_id)
            or sorted(set(job.get('channels') or [])) != sorted(set(request.channels))
            or job.get('date_range') != request.date_range
            or sorted(job.get('connection_ids') or []) != sorted(str(value) for value in request.connection_ids or [])):
        raise HTTPException(409, 'This request ID already belongs to a different import.')
    return {'status': 'accepted', 'job_id': job['id'], 'property_id': job['property_id'], 'reused': reused}


from jobs.marketing_import import run_import_job


@router.post('/sync-marketing-data', status_code=202, dependencies=[Depends(authorize)])
async def sync_marketing_data(request: SyncMarketingRequest, background_tasks: BackgroundTasks):
    supabase = get_supabase_client()
    job_id = str(request.job_id)

    def accept(job, reused):
        response = accepted_job(job, request, reused)
        if job.get('status') in ('pending', 'running') and job.get('recovery_version') != 1:
            raise HTTPException(409, 'This historical import needs review before it can be resumed.')
        if job.get('status') in ('pending', 'running'):
            # Re-dispatching the same queued ID is safe: the worker atomically
            # claims pending -> running. This also recovers a lost dispatch.
            background_tasks.add_task(run_import_job, job_id)
        return response

    try:
        existing = read_job(supabase, job_id)
        if existing:
            return accept(existing, reused=True)
        connections = supabase.table('ad_account_connections').select('id,platform').eq(
            'property_id', str(request.property_id)).eq('is_active', True).execute()
        if not isinstance(connections.data, list):
            raise RuntimeError('Connection lookup was not confirmed')
        matching = [connection for connection in connections.data if connection.get('platform') in request.channels]
        if request.connection_ids and not set(str(value) for value in request.connection_ids).issubset({connection.get('id') for connection in matching}):
            raise HTTPException(422, 'The requested accounts are not active for this property and channel.')
        if not matching:
            raise HTTPException(422, 'No active accounts match the requested channels. Connect an ad account in Settings.')
        try:
            result = supabase.table('import_jobs').insert({
                'id': job_id, 'property_id': str(request.property_id),
                'channels': sorted(set(request.channels)), 'date_range': request.date_range,
                'connection_ids': sorted(str(value) for value in request.connection_ids) if request.connection_ids else None,
                'status': 'pending', 'recovery_version': 1, 'progress_pct': 0, 'current_step': 'Queued for import',
                'created_at': datetime.now(timezone.utc).isoformat(),
            }).execute()
        except Exception:
            # Includes a concurrent identical request or a lost insert response.
            # Reuse a proven row; never dispatch again on an uncertain write.
            existing = read_job(supabase, job_id)
            if existing:
                return accept(existing, reused=True)
            raise
        job = result.data[0] if result.data else read_job(supabase, job_id)
        if not job:
            raise RuntimeError('Import job creation was not confirmed')
        return accept(job, reused=False)
    except HTTPException:
        raise
    except Exception:
        logger.exception('Could not confirm acceptance for import %s', job_id)
        raise HTTPException(503, 'Import acceptance could not be confirmed. Check its status before retrying the same request.')
