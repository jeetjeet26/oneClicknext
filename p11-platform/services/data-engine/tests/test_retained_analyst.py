import copy
import json
from unittest.mock import Mock
import pytest
from siteaudit import retained_analyst as a


def source():
    return {'property':{'name':'Fixture'},'findings':[{'id':'finding','severity':'high','status':'todo','title':'Missing title','affected_urls':['https://fixture.invalid/']}], 'pages':[{'url':'https://fixture.invalid/','status_code':200,'title':'Actual title'}], 'runs':[{'run':{'id':'run','status':'completed','surface':'chatgpt','model_name':'fixture','measurement_mode':'local_fixture'},'items':[{'answerId':'answer','query':{'id':'q','text':'Original prompt','type':'local'}}],'answers':[{'answer':{'id':'answer','query_id':'q','presence':False,'llm_rank':None,'sov':None}}]}]}


def job():
    return {'id':'analysis','lease_token':'token','source':source(),'source_hash':'hash','model_plan':{'provider':'openai','model':'gpt-5.6-sol'}}


def payload():
    return {'recommendations':[{'title':'Review the observed title','narrative':'The retained title finding supports reviewing this exact observed page before changing website copy.','type':'technical_fix','priority':'high','grounding':{'finding_ids':['finding'],'query_evidence':[]},'proposed_changes':[{'url':'https://fixture.invalid/','field':'title','proposed':'Proposed fixture title'}]}]}


def response():
    return {'response':{'id':'actual-receipt','usage':{'input_tokens':13}},'text':json.dumps(payload()),'error':None}


def test_retained_question_versions_and_repeats_never_overwrite_each_other():
    s=source(); second=copy.deepcopy(s['runs'][0]);second['run']['id']='later';second['items'][0]['query']['text']='Later wording';second['answers'][0]['answer']['presence']=True;s['runs'].append(second)
    third=copy.deepcopy(s['runs'][0]);third['run']['id']='repeat';s['runs'].append(third)
    context=a.retained_context(s)
    assert len(context['geo_signals'])==2
    original=next(q for q in context['geo_signals'] if q['prompt']=='Original prompt')
    assert [o['run_id'] for o in original['observations']]==['run','repeat']
    assert all(o['present'] is False for o in original['observations'])
    assert original['observations'][0]['sov'] is None


def test_complete_source_honestly_discloses_prompt_subset_and_unknown_answers():
    s=source();s['findings']=[{'id':str(n),'severity':'low','status':'todo'}for n in range(55)]+[{'id':'urgent','severity':'critical','status':'todo'}];s['pages']=[{'url':f'https://fixture.invalid/{n}','status_code':200,'inlink_count':n}for n in range(41)]
    s['runs'][0]['answers'].append({'answer':{'id':'unknown','query_id':'unknown'}})
    c=a.retained_context(s)
    assert c['findings'][0]['id']=='urgent'
    assert c['coverage']['findingsAvailable']==56 and c['coverage']['findingsSelected']==40
    assert c['coverage']['pagesAvailable']==41 and c['coverage']['pagesSelected']==30
    assert c['coverage']['answersWithoutCapturedQuestion']==1
    assert c['coverage']['missingAnswersAreNegative'] is False


def test_actual_provider_parameters_and_coverage_are_saved():
    request=a.provider_request(job())
    assert request['parameters']['max_completion_tokens']==16000
    assert 'Original prompt' in request['parameters']['messages'][1]['content']
    assert request['context']['coverage']==request['coverage']
    j=job();j['model_plan']={'provider':'anthropic','model':'fixture'}
    assert a.provider_request(j)['parameters']['max_tokens']==16000


@pytest.mark.asyncio
async def test_raw_receipt_is_saved_before_validation_and_current_recommendations_unchanged(monkeypatch):
    calls=[]
    def rpc(db,name,**args):
        calls.append((name,args))
        return {'state':{'start_geo_analysis_invocation':'claimed','retain_geo_analysis_receipt':'retained','finish_geo_recommendation':'saved'}[name]}
    invoke=Mock(return_value=response());monkeypatch.setattr(a,'invoke_provider',invoke);monkeypatch.setattr(a,'saved_rpc',rpc)
    await a.execute_retained_analysis(Mock(),job())
    assert [x[0] for x in calls]==['start_geo_analysis_invocation','retain_geo_analysis_receipt','finish_geo_recommendation']
    assert calls[1][1]['p_receipt']==response()
    assert calls[2][1]['p_preview']['acceptedCount']==1
    invoke.assert_called_once()


@pytest.mark.asyncio
async def test_saved_receipt_recovery_never_calls_provider(monkeypatch):
    j=job();request=a.provider_request(j);request['processorVersion']='earlier-validator';j['invocation']=request
    rpc=Mock(side_effect=[{'state':'retained','receipt':response(),'invocation':request},{'state':'saved','status':'ready'}]);invoke=Mock(side_effect=AssertionError('no provider replay'))
    monkeypatch.setattr(a,'saved_rpc',rpc);monkeypatch.setattr(a,'invoke_provider',invoke)
    assert (await a.execute_retained_analysis(Mock(),j))['status']=='ready'
    invoke.assert_not_called()
    assert rpc.call_args.kwargs['p_preview']['acceptedCount']==1
    assert rpc.call_args.kwargs['p_preview']['processorVersion']==a.PROCESSOR_VERSION


@pytest.mark.asyncio
@pytest.mark.parametrize('text',['not JSON', '[]','{"recommendations":[{"grounding":null}]}'])
async def test_invalid_actual_response_retained_before_explicit_hold(monkeypatch,text):
    receipt={'response':{'id':'raw-response'},'text':text,'error':None};rpc=Mock(side_effect=[{'state':'claimed'},{'state':'retained'},{'state':'saved','status':'held'}]);monkeypatch.setattr(a,'saved_rpc',rpc);monkeypatch.setattr(a,'invoke_provider',Mock(return_value=receipt))
    await a.execute_retained_analysis(Mock(),job())
    assert rpc.call_args_list[1].kwargs['p_receipt']==receipt
    assert rpc.call_args.kwargs['p_error']=='invalid_or_ungrounded_response'


@pytest.mark.asyncio
async def test_provider_error_does_not_trigger_fallback_or_repeat(monkeypatch):
    invoke=Mock(side_effect=TimeoutError('secret provider detail'));rpc=Mock(side_effect=[{'state':'claimed'},{'state':'retained'},{'state':'saved','status':'held'}]);monkeypatch.setattr(a,'invoke_provider',invoke);monkeypatch.setattr(a,'saved_rpc',rpc)
    await a.execute_retained_analysis(Mock(),job())
    invoke.assert_called_once()
    assert rpc.call_args_list[1].kwargs['p_receipt']=={'response':None,'text':'','error':'provider_outcome_unknown'}
    assert rpc.call_args.kwargs['p_error']=='provider_outcome_unknown'


@pytest.mark.asyncio
async def test_lost_retention_reply_retries_receipt_identity_only(monkeypatch):
    invoke=Mock(return_value=response());rpc=Mock(side_effect=[{'state':'claimed'},RuntimeError('missed reply'),{'state':'retained'},{'state':'saved','status':'ready'}]);monkeypatch.setattr(a,'invoke_provider',invoke);monkeypatch.setattr(a,'saved_rpc',rpc)
    await a.execute_retained_analysis(Mock(),job())
    invoke.assert_called_once();assert rpc.call_args_list[1]==rpc.call_args_list[2]


@pytest.mark.asyncio
async def test_unconfirmed_receipt_never_parses_or_applies(monkeypatch):
    invoke=Mock(return_value=response());rpc=Mock(side_effect=[{'state':'claimed'},RuntimeError('lost'),RuntimeError('lost')]);monkeypatch.setattr(a,'invoke_provider',invoke);monkeypatch.setattr(a,'saved_rpc',rpc)
    with pytest.raises(RuntimeError):await a.execute_retained_analysis(Mock(),job())
    invoke.assert_called_once();assert all(c.args[1]!='finish_geo_recommendation' for c in rpc.call_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize('state',['held','already_started','lease_lost'])
async def test_no_provider_call_without_new_authorized_claim(monkeypatch,state):
    invoke=Mock();monkeypatch.setattr(a,'invoke_provider',invoke);monkeypatch.setattr(a,'saved_rpc',Mock(return_value={'state':state}))
    assert (await a.execute_retained_analysis(Mock(),job()))['state']==state
    invoke.assert_not_called()


@pytest.mark.asyncio
async def test_legacy_generation_entrypoint_cannot_call_or_write():
    from siteaudit.analyst import SiteAuditAnalyst
    db=Mock()
    with pytest.raises(RuntimeError,match='recorded recommendation'):await SiteAuditAnalyst(db).generate('property','crawl','batch')
    assert db.mock_calls==[]


def test_proposed_current_copy_comes_from_actual_crawl_not_model_claim():
    from siteaudit.analyst import SiteAuditAnalyst
    value=payload();value['recommendations'][0]['proposed_changes'][0]['current']='Invented current title'
    result=SiteAuditAnalyst.__new__(SiteAuditAnalyst)._validate(value,a.retained_context(source()))
    assert result[0]['proposed_changes'][0]['current']=='Actual title'
