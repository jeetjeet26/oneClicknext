"""Capture crawl output before applying it under the current lease and authority."""
import asyncio
import hashlib
import json
import logging
import uuid
from siteaudit.crawler import SiteCrawler
from siteaudit.detectors import run_detectors
from siteaudit.findings import compute_fingerprint
from siteaudit.executor import SiteAuditExecutor

logger = logging.getLogger(__name__)

class CrawlLeaseLost(RuntimeError):
    pass

class CrawlReceiptUnconfirmed(RuntimeError):
    pass


def accepted(result):
    if not result or result.get('state') != 'saved':
        raise CrawlLeaseLost('Crawl output was not accepted by the current lease and authority')
    return result


def apply_receipt(db, crawl, receipt_id):
    try:
        result = db.rpc('apply_geo_crawl_receipt', {'p_id': receipt_id, 'p_crawl_id': crawl['id'], 'p_token': crawl['lease_token']}).execute().data
    except Exception as error:
        raise CrawlReceiptUnconfirmed('Captured output application is unconfirmed; recover its saved receipt') from error
    return accepted(result)


def save(db, crawl, kind, payload):
    if kind == 'heartbeat':
        return accepted(db.rpc('save_geo_site_crawl', {'p_crawl_id': crawl['id'], 'p_token': crawl['lease_token'], 'p_kind': kind, 'p_payload': payload}).execute().data)
    receipt_id = str(uuid.uuid4())
    args = {'p_id': receipt_id, 'p_crawl_id': crawl['id'], 'p_token': crawl['lease_token'], 'p_kind': kind, 'p_payload': payload}
    for attempt in range(2):
        try:
            result = db.rpc('retain_geo_crawl_receipt', args).execute().data
            if not result or result.get('state') != 'retained':
                raise CrawlReceiptUnconfirmed('Crawl output retention was not confirmed')
            break
        except Exception as error:
            if attempt == 1:
                raise CrawlReceiptUnconfirmed('Crawl output retention was not confirmed') from error
    return apply_receipt(db, crawl, receipt_id)


def row_digest(row):
    encoded = json.dumps(row, sort_keys=True, ensure_ascii=True, default=str).encode()
    return hashlib.sha256(encoded).hexdigest(), len(encoded)


async def execute_crawl(db, crawl):
    crawl = dict(crawl)
    task = None
    saved_pages = {}
    try:
        # Replay retained output before fetching again. A recovered final receipt can finish the job here.
        for receipt_id in crawl.get('pendingReceiptIds') or []:
            result = await asyncio.to_thread(apply_receipt, db, crawl, receipt_id)
            if result.get('status') in ('completed', 'failed'):
                return result
        if crawl.get('pendingReceiptIds'):
            current = await asyncio.to_thread(lambda: db.table('geo_site_crawls').select('*').eq('id', crawl['id']).eq('lease_token', crawl['lease_token']).single().execute().data)
            if not current or current.get('status') != 'running':
                raise CrawlLeaseLost('Recovered crawl lease is no longer current')
            crawl = current
        await asyncio.to_thread(save, db, crawl, 'heartbeat', {})

        async def heartbeat():
            while True:
                await asyncio.sleep(45)
                await asyncio.to_thread(save, db, crawl, 'heartbeat', {})
        task = asyncio.create_task(heartbeat())
        executor = SiteAuditExecutor(db)
        state = crawl.get('crawl_state') or {}
        resume = await asyncio.to_thread(executor._load_existing_pages, crawl['id']) if 'frontier' in state or crawl.get('pages_crawled', 0) or crawl.get('claim_count', 1) > 1 else []
        for page in resume:
            row = page.to_row(crawl['id'])
            saved_pages[row['url']] = row_digest(row)[0]
        if len(resume) > state.get('pages_crawled', 0):
            # Page receipts can survive a crash immediately before the matching checkpoint.
            # Reconstruct missing frontier entries from captured links, keeping already visited pages.
            state = dict(state)
            frontier = list(state.get('frontier') or [])
            queued = {url for url, _ in frontier} | {page.url for page in resume}
            for page in resume:
                for link in page.internal_links:
                    if link.get('url') and link['url'] not in queued:
                        frontier.append([link['url'], page.crawl_depth + 1]); queued.add(link['url'])
            state['frontier'] = frontier
            state['pages_crawled'] = len(resume)
            state['final'] = False
            state['recovery_limited'] = True

        def pages(records):
            batch, digests, size = [], {}, 0
            def flush():
                if batch:
                    save(db, crawl, 'pages', {'pages': list(batch)})
                    saved_pages.update(digests)
            for page in records:
                row = page.to_row(crawl['id'])
                digest, byte_count = row_digest(row)
                if saved_pages.get(row['url']) == digest:
                    continue
                if batch and (len(batch) >= 50 or size + byte_count > 8 * 1024 * 1024):
                    flush(); batch, digests, size = [], {}, 0
                batch.append(row); digests[row['url']] = digest; size += byte_count
            flush()

        async def checkpoint(checkpoint_state, records):
            checkpoint_state = {**checkpoint_state, 'recovery_limited': bool(state.get('recovery_limited'))}
            if task.done():
                task.result()
            await asyncio.to_thread(pages, records)
            await asyncio.to_thread(save, db, crawl, 'checkpoint', {'crawl_state': checkpoint_state, 'pages_discovered': checkpoint_state.get('pages_crawled', 0)})
        context = await SiteCrawler(seed_url=crawl['seed_url'], page_cap=crawl['page_cap'], concurrency=executor.concurrency, checkpoint=checkpoint, checkpoint_required=True, resume_state=state, resume_pages=resume).crawl()
        await asyncio.to_thread(pages, context.pages)
        findings = [{'fingerprint': compute_fingerprint(f), 'category': f.category, 'detector': f.detector, 'severity': f.severity, 'title': f.title, 'description': f.description, 'occurrences': f.occurrences, 'affected_urls': f.sample_urls(), 'affected_url_count': f.affected_url_count, 'evidence': f.evidence, 'owner': f.owner} for f in run_detectors(context)]
        return await asyncio.to_thread(save, db, crawl, 'completed', {
            'findings': findings, 'page_cap_reached': context.page_cap_reached,
            'recovery_limited': bool(state.get('recovery_limited')),
            'pages_discovered': len({p.url for p in context.pages} | set(context.sitemap_urls)),
            'robots_summary': {'reachable': context.robots_reachable, 'blocked_url_count': len(context.robots_blocked_urls), 'blocked_resource_count': len(context.robots_blocked_resources)},
            'sitemap_summary': {'reachable': context.sitemap_reachable, 'url_count': len(context.sitemap_urls)},
            'llms_txt_summary': {'reachable': context.llms_txt_reachable},
        })
    except CrawlLeaseLost:
        return {'state': 'lease_lost'}
    except CrawlReceiptUnconfirmed:
        logger.warning('Crawl output remains unconfirmed; the next lease must recover saved receipts')
        return {'state': 'receipt_unconfirmed'}
    except Exception as error:
        logger.exception('Recorded website crawl failed')
        try:
            await asyncio.to_thread(save, db, crawl, 'failed', {'error': str(error)[:2000]})
        except CrawlLeaseLost:
            return {'state': 'lease_lost'}
        except CrawlReceiptUnconfirmed:
            return {'state': 'receipt_unconfirmed'}
        return {'state': 'failed'}
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
