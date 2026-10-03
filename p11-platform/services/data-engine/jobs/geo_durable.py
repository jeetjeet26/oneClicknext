"""Durable, bounded GEO execution. Only explicitly enrolled jobs are eligible."""
import asyncio
import logging
import os
from jobs.propertyaudit import PropertyAuditExecutor
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

def rpc(db, name, **args):
    value = db.rpc(name, args).execute().data
    if value is None and name not in ('claim_geo_execution','claim_geo_analysis','claim_geo_site_crawl','claim_geo_recommendation'):
        raise RuntimeError(f'{name} persistence was not confirmed')
    return value

async def execute_claim(db, job):
    run_id, token = job['run_id'], job['lease_token']
    executor = PropertyAuditExecutor(db)
    snapshot = job['snapshot']
    mode = snapshot['run'].get('measurement_mode')
    if mode in ('natural','structured'): executor.audit_mode = mode
    next_work = rpc(db, 'advance_geo_execution', p_run_id=run_id, p_token=token)
    if next_work.get('state') in ('authorization_changed','reviewed_request_required','held'):
        return next_work
    while next_work.get('item'):
        item = next_work['item']
        invocation = rpc(db, 'start_geo_provider_invocation',
            p_run_id=run_id, p_token=token, p_item_id=item['id'])
        if invocation.get('state') == 'claimed':
            provider_result = None
            provider_error = None
            try:
                # Only an actual invocation claim permits a provider call.
                provider_result = await asyncio.wait_for(executor._process_query(
                    snapshot['run'], item['query_snapshot'], snapshot['property'], snapshot['config'], persist=False
                ), timeout=120)
                if not isinstance(provider_result, dict):
                    raise ValueError('Provider returned an invalid audit result')
            except Exception as error:
                provider_result = None
                provider_error = executor._classify_failure(str(error)) or 'provider_unavailable'
            # Keep provider retention separate from answer/score application.
            # Retrying this receipt identity cannot invoke the provider again.
            retained = None
            for retention_attempt in range(2):
                try:
                    retained = rpc(db, 'finish_geo_provider_invocation',
                        p_id=invocation['invocationId'], p_token=token,
                        p_result=provider_result, p_error=provider_error)
                    break
                except Exception:
                    if retention_attempt == 1:
                        raise
            if not retained or retained.get('state') != 'retained':
                raise RuntimeError('Provider response retention could not be confirmed')
        elif invocation.get('state') in ('authorization_changed','reviewed_request_required','held'):
            return invocation
        elif invocation.get('state') != 'retained':
            raise RuntimeError('Provider invocation is already underway or no longer authorized')
        next_work = rpc(db, 'apply_geo_provider_invocation',
            p_id=invocation['invocationId'], p_run_id=run_id, p_token=token)
        if next_work.get('retry_scheduled'):
            return next_work
        if next_work.get('state') in ('lease_lost', 'stopped','authorization_changed','reviewed_request_required','held'):
            return {'state': next_work['state'], 'response_retained': True}
    if not next_work.get('ready_to_finish'):
        raise RuntimeError('Unconfirmed execution transition')
    rows = db.table('geo_execution_items').select('score').eq('run_id', run_id).eq('state','completed').order('ordinal').limit(300).execute().data or []
    scores = [r['score'] for r in rows]
    aggregate = executor._calculate_aggregate_scores(scores) if scores else {}
    result = rpc(db, 'finish_geo_execution', p_run_id=run_id, p_token=token, p_aggregate=aggregate)
    return result

async def execute_analysis(db, job):
    from siteaudit.retained_analyst import execute_retained_analysis
    return await execute_retained_analysis(db, job)

async def durable_geo_worker():
    while True:
        try:
            db = get_supabase_client()
            job = await asyncio.to_thread(rpc, db, 'claim_geo_execution')
            if job:
                # Supabase's synchronous client/provider parsing cannot block
                # the API event loop. At most one active job per process.
                await asyncio.to_thread(lambda: asyncio.run(execute_claim(db, job)))
                continue
            if os.environ.get('SITEAUDIT_ENABLED', 'true').lower() != 'false':
                crawl = await asyncio.to_thread(rpc, db, 'claim_geo_site_crawl')
                if crawl:
                    from siteaudit.durable import execute_crawl
                    await asyncio.to_thread(lambda: asyncio.run(execute_crawl(db, crawl)))
                    continue
            from siteaudit.retained_analyst import analyst_plan
            analysis = await asyncio.to_thread(rpc, db, 'claim_geo_recommendation', p_plan=analyst_plan()) if os.environ.get('SITEAUDIT_ANALYST_ENABLED','true').lower()!='false' else None
            if analysis:
                await asyncio.to_thread(lambda: asyncio.run(execute_analysis(db,analysis)))
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('Durable GEO worker stopped its current attempt; lease recovery remains available')
        await asyncio.sleep(5)
