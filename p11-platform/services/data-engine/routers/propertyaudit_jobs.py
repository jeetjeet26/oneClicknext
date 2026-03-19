"""
PropertyAudit job router.
Exposes background execution endpoints used by the Next.js app.
"""

import asyncio
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from connectors.cross_model_analyzer import CrossModelAnalyzer
from jobs.propertyaudit import PropertyAuditExecutor
from utils.auth import verify_api_key
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs/propertyaudit", tags=["PropertyAudit"])


class RunRequest(BaseModel):
    run_id: str
    surface: Literal["openai", "claude"]
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
    if not batch_id:
        return

    supabase = get_supabase_client()
    runs_result = supabase.table("geo_runs").select(
        "id, surface, status"
    ).eq("batch_id", batch_id).execute()
    runs = runs_result.data or []

    if len(runs) < 2:
        return

    statuses = {run.get("status") for run in runs}
    surfaces = {run.get("surface") for run in runs}
    if statuses == {"completed"} and {"openai", "claude"}.issubset(surfaces):
        analyzer = CrossModelAnalyzer(supabase)
        analysis = await analyzer.analyze_batch(batch_id)
        if not analysis.get("success"):
            logger.warning("[PropertyAudit] Cross-model analysis failed for %s: %s", batch_id, analysis)


@router.post("/run")
async def run_propertyaudit(
    request: RunRequest,
    _: str = Depends(verify_api_key),
):
    supabase = get_supabase_client()
    executor = PropertyAuditExecutor(supabase)
    claimed_run = executor.claim_queued_run(request.run_id)

    if not claimed_run:
        run = _get_run_or_404(request.run_id)
        raise HTTPException(
            status_code=409,
            detail=f"Run {request.run_id} is not queued (status={run.get('status')})",
        )

    async def run_job():
        try:
            await executor.execute_run(request.run_id, claimed_run=claimed_run)
            await _maybe_analyze_batch(request.batch_id or claimed_run.get("batch_id"))
        except Exception as error:
            logger.exception("[PropertyAudit] Background run failed for %s: %s", request.run_id, error)

    asyncio.create_task(run_job())

    return {
        "success": True,
        "accepted": True,
        "run_id": request.run_id,
        "surface": request.surface,
        "batch_id": request.batch_id or claimed_run.get("batch_id"),
        "status": "running",
    }


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
    supabase = get_supabase_client()
    analyzer = CrossModelAnalyzer(supabase)
    result = await analyzer.analyze_batch(batch_id)

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Cross-model analysis failed"))

    analysis = result.get("analysis") or {}
    return {
        "success": True,
        "batch_id": batch_id,
        "message": "Cross-model analysis completed",
        "agreement_rate": analysis.get("agreement_rate"),
    }
