"""
PropertyAudit job router.
Exposes background execution endpoints used by the Next.js app.
"""

import asyncio
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from jobs.propertyaudit import PropertyAuditExecutor
from utils.auth import verify_api_key
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs/propertyaudit", tags=["PropertyAudit"])


class RunRequest(BaseModel):
    run_id: str
    surface: Literal["openai", "claude", "chatgpt", "gemini", "perplexity", "google_ai"]
    batch_id: Optional[str] = None


def _get_run_or_404(run_id: str):
    supabase = get_supabase_client()
    result = supabase.table("geo_runs").select(
        "id, status, progress_pct, current_query_index, error_message, "
        "started_at, finished_at, batch_id, surface, model_name"
    ).eq("id", run_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Run not found")

    return result.data


async def _maybe_analyze_batch(batch_id: Optional[str]):
    # The durable worker owns reviewed source/receipt processing.
    return None


def _execute_propertyaudit_job(run_id: str, claimed_run: dict, batch_id: Optional[str]):
    """
    Run long PropertyAudit execution outside the request event loop.

    The Render service currently runs a small worker count. Keeping the LLM
    execution on the request event loop can occupy every Uvicorn worker before
    later surfaces, like Claude in a multi-surface batch, get accepted.
    """

    async def runner():
        supabase = get_supabase_client()
        executor = PropertyAuditExecutor(supabase)
        try:
            await executor.execute_run(run_id, claimed_run=claimed_run)
            await _maybe_analyze_batch(batch_id or claimed_run.get("batch_id"))
        except Exception as error:
            logger.exception("[PropertyAudit] Background run failed for %s: %s", run_id, error)

    asyncio.run(runner())


@router.post("/run")
async def run_propertyaudit(
    request: RunRequest,
    _: str = Depends(verify_api_key),
):
    supabase = get_supabase_client()
    from jobs.geo_durable import rpc
    run = _get_run_or_404(request.run_id)
    if run['surface'] != request.surface or (request.batch_id and request.batch_id != run.get('batch_id')):
        raise HTTPException(status_code=409, detail='Run scope does not match dispatch request')
    try:
        result = rpc(supabase, 'enqueue_geo_execution', p_run_id=request.run_id)
    except Exception:
        raise HTTPException(status_code=503, detail='Could not confirm durable audit queue')
    return {**result, 'success': True, 'surface': run['surface'], 'batch_id': run.get('batch_id'), 'status': run['status']}


@router.get("/status/{run_id}")
async def get_propertyaudit_status(
    run_id: str,
    _: str = Depends(verify_api_key),
):
    run = _get_run_or_404(run_id)
    return {
        "success": True,
        "run_id": run["id"],
        "status": run.get("status"),
        "progress_pct": run.get("progress_pct"),
        "current_query_index": run.get("current_query_index"),
        "error_message": run.get("error_message"),
        "started_at": run.get("started_at"),
        "finished_at": run.get("finished_at"),
        "batch_id": run.get("batch_id"),
        "surface": run.get("surface"),
        "model_name": run.get("model_name"),
    }


@router.post("/batch/{batch_id}/reanalyze")
async def reanalyze_propertyaudit_batch(
    batch_id: str,
    _: str = Depends(verify_api_key),
):
    raise HTTPException(status_code=410, detail="Use the console's saved recommendation request and review flow")
