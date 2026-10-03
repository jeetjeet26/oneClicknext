"""Recoverable imports: versioned jobs, leased ownership and atomic batch checkpoints."""
import asyncio
import contextlib
import logging
import os
from datetime import datetime
from uuid import uuid4
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


async def rpc(client, name, params):
    result = await asyncio.to_thread(lambda: client.rpc(name, params).execute())
    return result.data


async def run_import_job(job_id: str):
    from pipelines.mcp_marketing_sync import MCPMarketingSync
    client = get_supabase_client()
    token = str(uuid4())
    ownership = {'p_job_id': job_id, 'p_token': token}
    claim = await rpc(client, 'claim_marketing_import', ownership)
    if not claim:
        return
    job = claim['job']
    syncer = MCPMarketingSync()
    syncer.reference_time = datetime.fromisoformat((job.get('reference_at') or job['created_at']).replace('Z', '+00:00'))
    lost_lease = asyncio.Event()

    async def heartbeat():
        while True:
            await asyncio.sleep(20)
            try:
                if await rpc(client, 'renew_marketing_import', ownership) is not True:
                    raise RuntimeError('Lease renewal not confirmed')
            except Exception:
                lost_lease.set()
                logger.exception('Import lease could not be renewed: %s', job_id)
                return

    heartbeat_task = asyncio.create_task(heartbeat())
    try:
        for account in claim['accounts']:
            if account['done']:
                continue
            if lost_lease.is_set():
                return
            account_args = {**ownership, 'p_connection_id': account['connection_id']}
            if account['records'] is None:
                if account['platform'] == 'google_ads':
                    outcome = await syncer._sync_google_ads(job['property_id'], account['account_id'], job['date_range'])
                else:
                    outcome = await syncer._sync_meta_ads(job['property_id'], account['account_id'], job['date_range'])
                if lost_lease.is_set():
                    return
                await rpc(client, 'save_marketing_import_report', {
                    **account_args,
                    'p_records': outcome['records'] if outcome['state'] == 'succeeded' else [],
                    'p_error': None if outcome['state'] == 'succeeded' else outcome.get('detail') or 'Provider report could not be verified.',
                })
            while not lost_lease.is_set():
                try:
                    checkpoint = await rpc(client, 'commit_marketing_import_batch', account_args)
                    if not isinstance(checkpoint, dict):
                        raise RuntimeError('Batch checkpoint not confirmed')
                    if checkpoint['done']:
                        break
                except Exception as error:
                    # A definite validation failure is reviewable; an uncertain
                    # transport response is recovered from the committed checkpoint.
                    if getattr(error, 'code', None) in {'23514', '22003', '22007', '23505', 'P0001'}:
                        detail = 'Saved account data needs review before another import.'
                        if 'Historical campaign rows need account reconciliation' in str(error):
                            detail = 'Historical campaign rows need account reconciliation before importing these dates.'
                        await rpc(client, 'fail_marketing_import_account', {**account_args, 'p_error': detail})
                        break
                    raise
        if not lost_lease.is_set():
            await rpc(client, 'finish_marketing_import', ownership)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Leave ownership to expire. Recovery reads database progress; it does
        # not infer zero writes from a failed acknowledgement or replay old jobs.
        logger.exception('Import paused; saved progress will be recovered: %s', job_id)
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task


async def recover_pending_imports():
    client = get_supabase_client()
    ids = await rpc(client, 'pending_marketing_imports', {})
    if not isinstance(ids, list):
        raise RuntimeError('Pending import inventory was not confirmed')
    for job_id in ids:
        try:
            await run_import_job(job_id)
        except Exception:
            logger.exception('Import recovery failed for %s', job_id)


async def marketing_import_worker():
    while True:
        try:
            await recover_pending_imports()
        except Exception:
            logger.exception('Marketing import recovery is unavailable')
        await asyncio.sleep(15)


def worker_enabled():
    return os.environ.get('MARKETING_IMPORT_WORKER_ENABLED') == 'true'
