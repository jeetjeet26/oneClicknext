#!/usr/bin/env python3
"""Prepare a scored inquiry for CRM review in a disposable local clone.

This deterministic rehearsal does not call a model, approve a provider write, or
activate a background worker. An operator registers exact scope and a shared
budget. Native request identities and a locked durable journal survive restarts.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import uuid
from client_lifecycle import LocalDatabase, digest, literal, private_json

CONTRACTS = ['request_crm_handoff', 'preview_crm_handoff', 'stop_crm_handoff',
             'crm_handoff_configuration_ready', 'crm_lead_preview_input', 'crm_record_handoff_action']

def now():
    return datetime.now(timezone.utc)

def native_state(db, property_id, actor, lead):
    values = [str(uuid.UUID(value)) for value in (property_id, actor, lead)]
    prop, actor, lead = map(literal, values)
    state = db.sql("""select jsonb_build_object('allowed',exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=""" + prop + "::uuid and u.id=" + actor + "::uuid and u.role in('admin','manager')), 'org',(select org_id from public.properties where id=" + prop + "::uuid),'sourceHash',encode(extensions.digest(jsonb_build_object('lead',(select to_jsonb(l) from public.leads l where l.id=" + lead + "::uuid and l.property_id=" + prop + "::uuid),'score',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.lead_scores s where s.lead_id=" + lead + "::uuid),'connection',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.integration_credentials c where c.property_id=" + prop + "::uuid))::text,'sha256'),'hex'),'leadExists',exists(select 1 from public.leads where id=" + lead + "::uuid and property_id=" + prop + "::uuid),'scored',exists(select 1 from public.lead_scores where lead_id=" + lead + "::uuid),'contractHash',(select encode(extensions.digest(string_agg(pg_get_functiondef(p.oid),E'\\n' order by p.proname),'sha256'),'hex') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(" + ','.join(map(literal, CONTRACTS)) + ')))')
    return json.loads(state)

def isolated(db):
    if db.name == 'postgres':
        raise ValueError('Native sandbox workflows are disabled in the active console and hosted systems')

def register(db, path, org, actor, properties, leads, expires_at, limit=2):
    isolated(db)
    if not isinstance(limit, int) or not 1 <= limit <= 2:
        raise ValueError('The rehearsal supports at most two preparation effects')
    expires = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
    if expires.tzinfo is None or not 0 < (expires-now()).total_seconds() <= 3600:
        raise ValueError('Register a scope lasting at most one hour')
    org, actor = str(uuid.UUID(org)), str(uuid.UUID(actor))
    snap = db.snapshot(org)
    if actor not in db.require_synthetic(snap):
        raise ValueError('The operator must belong to this exact synthetic client')
    if not leads or len(leads) > 2 or not properties or len(properties) > 2:
        raise ValueError('Choose one or two exact leads and properties')
    for lead in leads:
        if not any(r['table']=='public.leads' and r['data']['id']==lead and r['data']['property_id'] in properties for r in snap['rows']):
            raise ValueError('Lead is outside the registered client/property scope')
    scope = {'version':1,'database':db.name,'org':org,'actor':actor,'properties':properties,'leads':leads,
             'expiresAt':expires_at,'limit':limit,'used':0,'runs':{},'events':[],
             'source':'synthetic_local','execution':'deterministic_native_rehearsal','providerWrites':False,'trainingEligible':False}
    private_json(path, scope)
    return scope

@contextmanager
def journal(path):
    path = Path(path)
    with path.with_suffix(path.suffix+'.lock').open('a+') as lock:
        os.chmod(lock.name,0o600)
        fcntl.flock(lock,fcntl.LOCK_EX)
        state = json.loads(path.read_text())
        def save():
            temporary = path.with_suffix(path.suffix+'.next')
            with temporary.open('w') as f:
                os.chmod(temporary,0o600)
                json.dump(state,f,indent=2)
                f.flush();os.fsync(f.fileno())
            os.replace(temporary,path)
        yield state, save


def operate(db, path, run_id, operation, *, property_id=None, lead_id=None, interrupt_after_effect=False):
    isolated(db)
    run_id = str(uuid.UUID(run_id))
    if operation not in ['prepare','advance','pause','resume','cancel','undo']:
        raise ValueError('Unknown workflow operation')
    with journal(path) as (scope, save):
        if scope['database'] != db.name or scope['source'] != 'synthetic_local':
            raise ValueError('Scope belongs to another database')
        run = scope['runs'].get(run_id)
        if operation == 'prepare':
            if property_id not in scope['properties'] or lead_id not in scope['leads']:
                raise ValueError('Target is outside the registered scope')
            if run:
                if (run['property'],run['lead']) != (property_id,lead_id):
                    raise ValueError('A saved request cannot change targets')
                return run
            if datetime.fromisoformat(scope['expiresAt']) <= now():
                raise ValueError('Scope expired')
            observed = native_state(db,property_id,scope['actor'],lead_id)
            if not observed['allowed'] or str(observed['org']) != scope['org'] or not observed['leadExists'] or not observed['scored']:
                raise ValueError('Current permission, client, lead or scoring evidence is missing')
            run = {'id':run_id,'property':property_id,'lead':lead_id,'sourceHash':observed['sourceHash'],
                   'contractHash':observed['contractHash'],'state':'prepared','reservation':False,
                   'nativeKey':'sandbox-crm/'+run_id,'undoId':str(uuid.uuid4()),'handoffId':None,
                   'afterHash':None,'effects':0,'businessOutcome':'unmeasured'}
            scope['runs'][run_id] = run
        else:
            if not run:
                raise ValueError('Prepare the exact workflow first')
            observed = native_state(db,run['property'],scope['actor'],run['lead'])
            if not observed['allowed'] or str(observed['org']) != scope['org']:
                raise ValueError('Current operator permission was withdrawn')
            if operation in ['cancel','undo']:
                if observed['contractHash'] != run['contractHash']:
                    raise ValueError('The native action contract changed before cancellation')
                existing = json.loads(db.sql("select coalesce((select to_jsonb(h) from public.crm_handoffs h where h.property_id=" + literal(run['property']) + "::uuid and h.request_key=" + literal(run['nativeKey']) + "),'null')"))
                if existing:
                    approved = db.sql('select count(*) from public.crm_handoff_approvals where handoff_id=' + literal(existing['id']) + '::uuid')
                    if existing['state'] == 'cancelled':
                        run['state'] = 'reversed'
                    elif approved != '0' or (run['afterHash'] and digest(existing) != run['afterHash']) or existing['state'] != 'queued':
                        raise ValueError('Human edits or provider activity require review before undo')
                    else:
                        result = json.loads(db.sql('select public.stop_crm_handoff(' + ','.join(literal(v)+'::uuid' for v in [run['property'],scope['actor'],existing['id'],run['undoId']]) + ')'))
                        if result['state'] != 'cancelled':
                            raise ValueError('Native cancellation requires review')
                        run['state'] = 'reversed'
                    run['handoffId'] = existing['id']
                else:
                    run['state'] = 'cancelled'
            elif operation == 'pause':
                if run['state'] not in ['prepared','reserved','paused']:
                    raise ValueError('This workflow is no longer waiting')
                run['state'] = 'paused'
            elif operation == 'resume':
                if run['state'] != 'paused':
                    raise ValueError('Only paused work can resume')
                run['state'] = 'reserved' if run['reservation'] else 'prepared'
            elif operation == 'advance':
                if run['state'] in ['cancelled','reversed','paused']:
                    raise ValueError('Stopped or paused work cannot advance')
                if run['state'] == 'completed':
                    return run
                if datetime.fromisoformat(scope['expiresAt']) <= now():
                    raise ValueError('Scope expired; no additional effect is permitted')
                if observed['contractHash'] != run['contractHash']:
                    raise ValueError('The native action contract changed')
                if not run['reservation']:
                    if observed['sourceHash'] != run['sourceHash']:
                        raise ValueError('Source evidence changed after review')
                    if scope['used'] >= scope['limit']:
                        raise ValueError('The shared preparation budget is exhausted')
                    scope['used'] += 1
                    run['reservation'] = True
                    run['state'] = 'reserved'
                    save() # Persist before invoking; a lost reply consumes no second reservation.
                prop, actor, lead, key = map(literal,[run['property'],scope['actor'],run['lead'],run['nativeKey']])
                # Lock the same native property lane, lead and connection. Recheck exact
                # source evidence inside the transaction before the first effect.
                guard = f"""DO $guard$ DECLARE current_hash text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.crm_handoffs WHERE property_id={prop}::uuid AND request_key={key}) THEN
 SELECT encode(extensions.digest(jsonb_build_object(
 'lead',(select to_jsonb(l) from public.leads l where l.id={lead}::uuid and l.property_id={prop}::uuid),
 'score',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.lead_scores s where s.lead_id={lead}::uuid),
 'connection',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.integration_credentials c where c.property_id={prop}::uuid))::text,'sha256'),'hex') INTO current_hash;
 IF current_hash<>{literal(run['sourceHash'])} THEN RAISE EXCEPTION 'Source evidence changed before native invocation'; END IF;
 END IF; END $guard$;"""
                sql = "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(" + prop + ",12)); SELECT id FROM public.leads WHERE id=" + lead + "::uuid FOR UPDATE; SELECT id FROM public.integration_credentials WHERE property_id=" + prop + "::uuid FOR SHARE; " + guard + ' SELECT public.request_crm_handoff(' + prop + '::uuid,' + lead + '::uuid,' + key + ",'operator'," + actor + '::uuid,NULL); COMMIT;'
                result = json.loads(db.sql(sql).splitlines()[-1])
                if result['state'] not in ['queued','replayed']:
                    raise ValueError('Native preparation did not complete: '+result['state'])
                if interrupt_after_effect:
                    raise RuntimeError('Simulated process interruption after native commit; resume the same run')
                row = json.loads(db.sql('select to_jsonb(h) from public.crm_handoffs h where id=' + literal(result['handoffId']) + '::uuid'))
                if row['state'] != 'queued':
                    raise ValueError('The saved effect was changed by another operator')
                run['handoffId'] = row['id'];run['afterHash'] = digest(row);run['effects'] = 1
                preview = json.loads(db.sql('select public.preview_crm_handoff(' + ','.join(literal(v)+'::uuid' for v in [run['property'],scope['actor'],row['id']]) + ')'))
                run['previewHash'] = digest(preview);run['state'] = 'completed'
        scope['events'].append({'run':run_id,'operation':operation,'state':run['state'],'at':now().isoformat()})
        save()
        return run

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True);parser.add_argument('--journal',type=Path,required=True)
    sub=parser.add_subparsers(dest='command',required=True)
    q=sub.add_parser('register');q.add_argument('--org',required=True);q.add_argument('--actor',required=True);q.add_argument('--property',action='append',required=True);q.add_argument('--lead',action='append',required=True);q.add_argument('--expires-at',required=True);q.add_argument('--limit',type=int,default=2)
    q=sub.add_parser('operate');q.add_argument('--run',required=True);q.add_argument('--operation',choices=['prepare','advance','pause','resume','cancel','undo'],required=True);q.add_argument('--property');q.add_argument('--lead')
    args=parser.parse_args()
    try:
        db=LocalDatabase(args.database)
        if args.command=='register':
            register(db,args.journal,args.org,args.actor,args.property,args.lead,args.expires_at,args.limit);result={'state':'registered'}
        else:result=operate(db,args.journal,args.run,args.operation,property_id=args.property,lead_id=args.lead)
        print(json.dumps(result));return 0
    except (ValueError,RuntimeError,OSError) as error:
        print(json.dumps({'state':'needs_review','reason':str(error)}));return 1
if __name__=='__main__':raise SystemExit(main())
