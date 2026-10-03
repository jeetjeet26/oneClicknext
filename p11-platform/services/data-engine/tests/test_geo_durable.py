from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from jobs import geo_durable as worker

JOB={'run_id':'run','lease_token':'token','snapshot':{'run':{'id':'run','measurement_mode':'natural'},'property':{'name':'Fixture'},'config':{}}}
ITEM={'id':'item','query_snapshot':{'id':'query','text':'Fixture question'}}
ANSWER={'answer':{'run_id':'run'},'citations':[],'score':{'score':50}}
CLAIM={'state':'claimed','invocationId':'invocation'}
RETAINED={'state':'retained','invocationId':'invocation'}

def setup(monkeypatch, responses, process=None):
    executor=SimpleNamespace(_process_query=process or AsyncMock(return_value=ANSWER),_calculate_aggregate_scores=Mock(return_value={'overall_score':50}),_classify_failure=Mock(return_value='missing_provider_key'))
    monkeypatch.setattr(worker,'PropertyAuditExecutor',lambda db:executor)
    rpc=Mock(side_effect=responses);monkeypatch.setattr(worker,'rpc',rpc)
    query=Mock();query.select.return_value=query;query.eq.return_value=query;query.order.return_value=query;query.limit.return_value=query;query.execute.return_value=SimpleNamespace(data=[{'score':{'score':50}}])
    db=Mock();db.table.return_value=query
    return executor,rpc,db

@pytest.mark.asyncio
async def test_completed_work_is_not_invoked_again(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'ready_to_finish':True},{'state':'completed'}])
    assert await worker.execute_claim(db,JOB)=={'state':'completed'}
    executor._process_query.assert_not_awaited()

@pytest.mark.asyncio
async def test_response_retention_precedes_application_and_has_no_unfenced_side_writes(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},CLAIM,RETAINED,{'ready_to_finish':True},{'state':'completed'}])
    await worker.execute_claim(db,JOB)
    assert executor._process_query.call_args.kwargs=={'persist':False}
    assert [c.args[1]for c in rpc.call_args_list]==['advance_geo_execution','start_geo_provider_invocation','finish_geo_provider_invocation','apply_geo_provider_invocation','finish_geo_execution']
    assert rpc.call_args_list[2].kwargs=={'p_id':'invocation','p_token':'token','p_result':ANSWER,'p_error':None}

@pytest.mark.asyncio
async def test_missing_provider_is_retained_and_applied_as_bounded_failure(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},CLAIM,RETAINED,{'retry_scheduled':True}],AsyncMock(side_effect=RuntimeError('API key missing')))
    assert await worker.execute_claim(db,JOB)=={'retry_scheduled':True}
    assert rpc.call_args_list[2].kwargs['p_error']=='missing_provider_key'
    assert rpc.call_args_list[2].kwargs['p_result']is None

@pytest.mark.asyncio
async def test_storage_ack_failure_retries_same_receipt_without_repeating_provider(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},CLAIM,RuntimeError('lost acknowledgement'),RETAINED,{'ready_to_finish':True},{'state':'completed'}])
    await worker.execute_claim(db,JOB)
    executor._process_query.assert_awaited_once();executor._classify_failure.assert_not_called()
    assert rpc.call_args_list[2]==rpc.call_args_list[3]

@pytest.mark.asyncio
async def test_unconfirmed_retention_stops_before_application(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},CLAIM,RuntimeError('lost acknowledgement'),RuntimeError('lost acknowledgement')])
    with pytest.raises(RuntimeError,match='acknowledgement'):await worker.execute_claim(db,JOB)
    executor._process_query.assert_awaited_once();executor._classify_failure.assert_not_called()
    assert all(c.args[1]!='apply_geo_provider_invocation'for c in rpc.call_args_list)

@pytest.mark.asyncio
async def test_retained_response_recovers_without_another_model_call(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},RETAINED,{'ready_to_finish':True},{'state':'completed'}])
    await worker.execute_claim(db,JOB)
    executor._process_query.assert_not_awaited()
    assert all(c.args[1]!='finish_geo_provider_invocation'for c in rpc.call_args_list)

@pytest.mark.asyncio
async def test_application_failure_cannot_be_misclassified_as_provider_failure(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},CLAIM,RETAINED,RuntimeError('application unavailable')])
    with pytest.raises(RuntimeError,match='application unavailable'):await worker.execute_claim(db,JOB)
    executor._process_query.assert_awaited_once();executor._classify_failure.assert_not_called()

@pytest.mark.asyncio
async def test_stopped_lease_keeps_returned_response_without_claiming_completion(monkeypatch):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},CLAIM,RETAINED,{'state':'lease_lost'}])
    assert await worker.execute_claim(db,JOB)=={'state':'lease_lost','response_retained':True}
    assert all(c.args[1]!='finish_geo_execution'for c in rpc.call_args_list)

@pytest.mark.asyncio
@pytest.mark.parametrize('state',['in_progress','lease_lost','item_changed'])
async def test_only_owned_invocation_can_call_provider(monkeypatch,state):
    executor,rpc,db=setup(monkeypatch,[{'item':ITEM},{'state':state,'invocationId':'invocation'}])
    with pytest.raises(RuntimeError,match='already underway or no longer authorized'):await worker.execute_claim(db,JOB)
    executor._process_query.assert_not_awaited()

@pytest.mark.asyncio
async def test_analysis_routes_through_retained_receipt_worker(monkeypatch):
    import siteaudit.retained_analyst
    execute = AsyncMock(return_value={'state':'saved','status':'ready'})
    monkeypatch.setattr(siteaudit.retained_analyst,'execute_retained_analysis',execute)
    db, job = Mock(), {'id':'analysis','lease_token':'token'}
    assert await worker.execute_analysis(db,job) == {'state':'saved','status':'ready'}
    execute.assert_awaited_once_with(db,job)

@pytest.mark.asyncio
async def test_analysis_persistence_failure_stays_uncertain(monkeypatch):
    import siteaudit.retained_analyst
    execute = AsyncMock(side_effect=RuntimeError('receipt unconfirmed'))
    monkeypatch.setattr(siteaudit.retained_analyst,'execute_retained_analysis',execute)
    with pytest.raises(RuntimeError,match='receipt unconfirmed'):
        await worker.execute_analysis(Mock(),{'id':'analysis','lease_token':'token'})
