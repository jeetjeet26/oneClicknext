import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock,patch
import pytest
from siteaudit.durable import execute_crawl,CrawlLeaseLost,CrawlReceiptUnconfirmed,save
from siteaudit.models import CrawlContext,PageRecord
from siteaudit.crawler import SiteCrawler
from siteaudit.executor import SiteAuditExecutor

CRAWL={'id':'crawl','lease_token':'token','seed_url':'https://fixture.invalid','page_cap':2,'crawl_state':{}}
PAGE=PageRecord(url=CRAWL['seed_url'],status_code=200,content_type='text/html',title='Retained title')

def fake_db(fail=None):
    calls=[];receipts={};db=MagicMock()
    def rpc(name,args):
        calls.append((name,args))
        def execute():
            if fail:
                outcome=fail(name,args,calls)
                if isinstance(outcome,Exception):raise outcome
                if outcome is not None:return SimpleNamespace(data=outcome)
            if name=='retain_geo_crawl_receipt':
                receipts[args['p_id']]=args
                return SimpleNamespace(data={'state':'retained'})
            if name=='apply_geo_crawl_receipt':
                kind=receipts.get(args['p_id'],{}).get('p_kind')
                return SimpleNamespace(data={'state':'saved','status':'completed' if kind=='completed' else 'running'})
            return SimpleNamespace(data={'state':'saved','status':'running'})
        return SimpleNamespace(execute=execute)
    db.rpc.side_effect=rpc
    return db,calls,receipts

def run(fail=None,crawl=None,resume=None):
    db,calls,receipts=fake_db(fail);kwargs=[];loaded=[]
    ctx=CrawlContext(origin='https://fixture.invalid',seed_url=CRAWL['seed_url'],pages=[PAGE],page_cap_reached=True)
    class Crawler:
        def __init__(self,**kw):kwargs.append(kw);self.kw=kw
        async def crawl(self):
            await self.kw['checkpoint']({'frontier':[],'pages_crawled':1},ctx.pages)
            return ctx
    def load(id):loaded.append(id);return resume or []
    with patch('siteaudit.durable.SiteCrawler',Crawler),patch('siteaudit.durable.run_detectors',return_value=[]),patch('siteaudit.durable.SiteAuditExecutor',return_value=SimpleNamespace(concurrency=1,_load_existing_pages=load)):
        result=asyncio.run(execute_crawl(db,crawl or CRAWL))
    return result,calls,kwargs,loaded

def test_capture_commits_before_application_and_final_repeat_is_deduplicated():
    result,calls,kwargs,_=run()
    assert result['status']=='completed'
    assert [a['p_kind'] for n,a in calls if n=='retain_geo_crawl_receipt']==['pages','checkpoint','completed']
    for index,(name,args) in enumerate(calls):
        if name=='apply_geo_crawl_receipt':assert calls[index-1][0]=='retain_geo_crawl_receipt' and calls[index-1][1]['p_id']==args['p_id']
    assert calls[0][1]['p_kind']=='heartbeat'
    assert kwargs[0]['checkpoint_required'] is True
    assert next(a for n,a in calls if n=='retain_geo_crawl_receipt')['p_payload']['pages'][0]['title']=='Retained title'

@pytest.mark.parametrize('phase',['heartbeat','pages','checkpoint','completed'])
def test_permission_loss_or_stop_never_publishes_failure_over_saved_evidence(phase):
    ids={}
    def failure(name,args,_):
        if name=='retain_geo_crawl_receipt':ids[args['p_id']]=args['p_kind']
        if name=='apply_geo_crawl_receipt' and ids.get(args['p_id'])==phase:return {'state':'authorization_changed'}
        if name=='save_geo_site_crawl' and phase=='heartbeat':return {'state':'lease_lost'}
    result,calls,kwargs,_=run(failure)
    assert result['state']=='lease_lost'
    assert all(a.get('p_kind')!='failed' for _,a in calls)
    if phase=='heartbeat':assert not kwargs

@pytest.mark.parametrize('uncertain',['retain_geo_crawl_receipt','apply_geo_crawl_receipt'])
def test_unconfirmed_output_is_left_for_recovery_without_failed_overwrite(uncertain):
    result,calls,_,_=run(lambda name,args,calls:RuntimeError('missed reply') if name==uncertain else None)
    assert result['state']=='receipt_unconfirmed'
    retained=[a for n,a in calls if n=='retain_geo_crawl_receipt']
    assert all(a['p_kind']=='pages' for a in retained)
    if uncertain=='retain_geo_crawl_receipt':assert len(retained)==2 and retained[0]==retained[1]

def test_missed_retention_reply_reuses_exact_identity_and_payload():
    attempts=0
    def fail(name,args,calls):
        nonlocal attempts
        if name=='retain_geo_crawl_receipt':
            attempts+=1
            if attempts==1:return RuntimeError('missed reply')
    db,calls,_=fake_db(fail)
    assert save(db,CRAWL,'pages',{'pages':[]})['state']=='saved'
    assert calls[0][1]==calls[1][1]
    assert calls[2][0]=='apply_geo_crawl_receipt'

def test_recovered_final_receipt_finishes_without_crawler_or_provider():
    result,calls,kwargs,loaded=run(lambda name,args,calls:{'state':'saved','status':'completed'} if name=='apply_geo_crawl_receipt' else None,{**CRAWL,'pendingReceiptIds':['saved-final']})
    assert result['status']=='completed' and not kwargs and not loaded
    assert len(calls)==1

def test_empty_final_frontier_loads_saved_pages_without_seeding_again():
    result,calls,kwargs,loaded=run(crawl={**CRAWL,'crawl_state':{'frontier':[],'pages_crawled':1,'final':True}},resume=[PAGE])
    assert result['status']=='completed' and loaded==['crawl']
    assert kwargs[0]['resume_pages']==[PAGE] and kwargs[0]['resume_state']['frontier']==[]
    assert all(a.get('p_kind')!='pages' for _,a in calls)

def test_page_before_checkpoint_recovers_from_bounded_links_with_explicit_limit():
    page=PageRecord(url=PAGE.url,internal_links=[{'url':PAGE.url+'/next'}],crawl_depth=1)
    result,calls,kwargs,loaded=run(crawl={**CRAWL,'claim_count':2},resume=[page])
    assert loaded==['crawl']
    assert kwargs[0]['resume_state']['frontier']==[[PAGE.url+'/next',2]]
    assert kwargs[0]['resume_state']['recovery_limited'] is True
    assert all(a['p_payload'].get('recovery_limited') is True for n,a in calls if n=='retain_geo_crawl_receipt' and a['p_kind']=='completed')

@pytest.mark.parametrize('required',[False,True])
def test_required_checkpoint_failure_stops_the_crawler(required):
    async def checkpoint(*_):raise CrawlReceiptUnconfirmed('retained reply missing')
    crawler=SiteCrawler(seed_url=PAGE.url,checkpoint=checkpoint,checkpoint_required=required)
    if required:
        with pytest.raises(CrawlReceiptUnconfirmed):asyncio.run(crawler._run_checkpoint())
    else:asyncio.run(crawler._run_checkpoint())

def test_frontier_over_2000_is_retained_in_full_with_budget_disclosure():
    saved=[]
    async def checkpoint(state,_):saved.append(state)
    crawler=SiteCrawler(seed_url=PAGE.url,page_cap=2500,checkpoint=checkpoint,checkpoint_required=True)
    for i in range(2600):crawler._enqueue(PAGE.url+'/'+str(i),1)
    asyncio.run(crawler._run_checkpoint())
    assert len(saved[0]['frontier'])==2500
    assert saved[0]['frontier_limit_reached'] is True

@pytest.mark.parametrize('state',[None,{}, {'final':True}])
def test_legacy_missing_checkpoint_never_changes_failed_status(state):
    db=MagicMock();db.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value.data=[{'crawl_state':state}]
    assert SiteAuditExecutor(db).claim_resumable_crawl('crawl') is None
    db.table.return_value.update.assert_not_called()

@pytest.mark.parametrize('revision',['2026-01-01T00:00:00Z',None])
def test_legacy_empty_frontier_accepts_only_the_reviewed_checkpoint_revision(revision):
    db=MagicMock();q=db.table.return_value
    q.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value.data=[{'crawl_state':{'frontier':[]},'last_updated_at':revision}]
    updated=q.update.return_value.eq.return_value.eq.return_value.is_.return_value
    chosen=updated.eq.return_value if revision else updated.is_.return_value
    chosen.execute.return_value.data=[] # a concurrent update wins
    assert SiteAuditExecutor(db).claim_resumable_crawl('crawl') is None
    (updated.eq if revision else updated.is_).assert_called_once_with('last_updated_at',revision if revision else 'null')

def test_old_public_run_route_requires_recorded_request_without_side_effects():
    from fastapi import HTTPException
    from routers.siteaudit_jobs import run_siteaudit,CrawlRequest
    with patch('routers.siteaudit_jobs.get_supabase_client') as db,pytest.raises(HTTPException) as error:
        asyncio.run(run_siteaudit(CrawlRequest(crawl_id='crawl'),_='test'))
    assert error.value.status_code==410
    db.assert_not_called()

def test_manifest_route_still_loads_persisted_context():
    from routers.siteaudit_jobs import generate_migration_manifest,ManifestRequest
    ctx=CrawlContext(origin=PAGE.url,seed_url=PAGE.url,pages=[PAGE])
    with patch('routers.siteaudit_jobs._get_crawl_or_404',return_value={'id':'crawl','status':'completed','property_id':'property'}),patch('routers.siteaudit_jobs.get_supabase_client'),patch('routers.siteaudit_jobs.SiteAuditExecutor') as executor,patch('routers.siteaudit_jobs.build_migration_manifest',return_value={'retained':True}):
        executor.return_value.load_persisted_context.return_value=ctx
        assert asyncio.run(generate_migration_manifest(ManifestRequest(crawl_id='crawl',target_url=PAGE.url),_='test'))=={'success':True,'manifest':{'retained':True}}
