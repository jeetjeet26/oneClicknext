"""Saved qualification of exact lead writes. Activation is a separate operator decision."""
from jobs.crm_delivery import rpc
from utils.delivery_guard import require_delivery_enabled
from connectors.crm_adapters.verified_rest import SAFE_ID,canonical

class CheckpointUnconfirmed(RuntimeError):pass

def exact_record(adapter,identity,payload,email_field):
    record=adapter.get_lead(identity)
    returned=record.get('id',record.get('Id'))
    if str(returned or '')!=identity:return False
    for key,expected in payload.items():
        actual=record.get(key)
        if key==email_field:
            if canonical('email',actual)!=canonical('email',expected):return False
        elif actual is None or str(actual)!=str(expected):return False
    return True

def run_crm_qualification(operation_id,adapter_factory):
    saved=rpc('claim_crm_qualification',{'p_operation_id':operation_id})
    if saved.get('state')!='claimed':return {'state':saved.get('state','unknown')}
    common={'p_operation_id':operation_id,'p_claim_id':saved['claimId']}
    receipts=dict(saved.get('receipts',{}))
    def checkpoint(stage,result):
        try:data=rpc('checkpoint_crm_qualification',{**common,'p_stage':stage,'p_result':result})
        except Exception as error:raise CheckpointUnconfirmed('CRM test checkpoint unavailable') from error
        if data.get('state') not in ('saved','replayed','proceed_once'):raise CheckpointUnconfirmed('CRM test checkpoint unavailable')
        receipts[stage]=result
        return data['state']
    def finish():
        try:return rpc('finish_crm_qualification',common)
        except Exception as error:raise CheckpointUnconfirmed('CRM test completion unavailable') from error
    def held(reason):
        if 'failure' not in receipts:checkpoint('failure',{'reason':reason})
        return finish()
    try:
        adapter=adapter_factory(saved['platform'],saved['credentials'])
        if getattr(adapter,'contract_version',None)!='crm-exact-v1':return held('provider_contract_required')
        adapter.read_fields=list(saved['mapping'].values())
        identity=adapter.account_identity()
    except CheckpointUnconfirmed:raise
    except Exception:return held('provider_identity_unconfirmed')
    if 'preflight' in receipts:
        if receipts['preflight'].get('identity')!=identity:return held('provider_account_changed')
    else:
        try:
            adapter.validate_values(saved['payload'],saved['mapping'])
            existing=adapter.search_lead(saved['source']['email'])
        except Exception:return held('schema_or_search_unconfirmed')
        if existing.error or existing.found:return held('test_record_already_present_or_search_unconfirmed')
        checkpoint('preflight',{'identity':identity,'contractVersion':adapter.contract_version})
    if 'created' not in receipts:
        if 'create_intent' in receipts:
            # A lost create acknowledgement permits a read, never a second create.
            try:
                found=adapter.search_lead(saved['source']['email'])
                if found.error or not found.found or not SAFE_ID.fullmatch(str(found.external_id or '')):return held('test_destination_unconfirmed')
                if not exact_record(adapter,found.external_id,saved['payload'],saved['mapping']['email']):return held('test_record_changed')
            except CheckpointUnconfirmed:raise
            except Exception:return held('test_destination_unconfirmed')
            checkpoint('created',{'externalId':found.external_id,'confirmed':False,'recovered':True})
        else:
            try:require_delivery_enabled()
            except Exception:return held('delivery_paused')
            if checkpoint('create_intent',{})!='proceed_once':return finish()
            try:created=adapter.create_lead(saved['payload'])
            except Exception:return held('create_acknowledgement_unconfirmed')
            if not created.success or created.confirmation!='confirmed' or not SAFE_ID.fullmatch(str(created.external_id or '')):return held('create_acknowledgement_unconfirmed')
            checkpoint('created',{'externalId':str(created.external_id),'confirmed':True,'recovered':False})
    destination=receipts['created']['externalId']
    if 'cleanup' in receipts:return finish()
    try:
        if adapter.record_absent(destination):
            checkpoint('cleanup',{'externalId':destination,'absent':True,'recovered':True})
            return finish()
        matches=exact_record(adapter,destination,saved['payload'],saved['mapping']['email'])
    except CheckpointUnconfirmed:raise
    except Exception:return held('test_record_read_unconfirmed')
    if not matches:return held('test_record_changed')
    if 'readback' not in receipts:checkpoint('readback',{'externalId':destination,'matches':True})
    if 'search' not in receipts:
        try:
            found=adapter.search_lead(saved['source']['email'])
            matches=not found.error and found.found and found.external_id==destination
        except Exception:matches=False
        checkpoint('search',{'externalId':destination,'matches':bool(matches)})
    if 'cleanup_intent' in receipts:
        # The provider may still be handling an earlier delete. Keep evidence and hold.
        return held('cleanup_not_confirmed')
    try:require_delivery_enabled()
    except Exception:return held('cleanup_waits_for_delivery_permission')
    if checkpoint('cleanup_intent',{'externalId':destination})!='proceed_once':return finish()
    try:adapter.delete_lead(destination)
    except Exception:pass
    try:absent=adapter.record_absent(destination)
    except Exception:absent=False
    if absent:checkpoint('cleanup',{'externalId':destination,'absent':True,'recovered':False})
    return finish() if absent else held('cleanup_not_confirmed')
