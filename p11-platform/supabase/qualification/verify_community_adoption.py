"""Check a rehearsed adoption in an explicitly disposable Docker database."""
import argparse
import json
import subprocess
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True)
    parser.add_argument('--manifest',type=Path,required=True)
    args=parser.parse_args()
    if not args.database.startswith('community_brain_replay_')or not args.database.replace('_','').isalnum():raise ValueError('Disposable rehearsal database required')
    m=json.loads(args.manifest.read_text());p=m['propertyId'];first=m['sources'][0]['evidenceId']
    sql=f"""begin;
    create function pg_temp.check_it(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Adoption assertion failed: %',label;end if;end$$;
    select pg_temp.check_it((select count(*)=1 from public.community_adoption_receipts where id='{m['receiptId']}'),'one immutable adoption receipt');
    select pg_temp.check_it((select count(*)={m['legacyChunksRetained']} from public.documents where property_id='{p}'and evidence_id is null),'all old vectors retained but ineligible');
    select pg_temp.check_it(jsonb_array_length(public.brain_canonical_context('{p}','chat')->'facts')={len(m['sources'])},'all reviewed current facts available');
    select pg_temp.check_it(public.brain_canonical_context('{p}','chat')->'floorplans'='[]'::jsonb,'old unconfirmed units cannot establish inventory');
    select pg_temp.check_it((select cardinality(amenities)=0 from public.properties where id='{p}') and not(public.brain_canonical_context('{p}','chat')->'property'?'amenities'),'old extracted spa claim removed and unreviewed amenities excluded');
    select pg_temp.check_it(public.brain_canonical_context('{p}','chat')::text !~ '2595000|2675000|50,000|May 2026','stale commercial figures absent');
    select pg_temp.check_it(not public.brain_evidence_eligible('{first}','00000000-0000-4000-8000-000000000001','chat','public'),'evidence cannot be reused in a different community');
    update public.community_evidence set review_status='withdrawn'where id='{first}';
    select pg_temp.check_it(jsonb_array_length(public.brain_canonical_context('{p}','chat')->'facts')={len(m['sources'])-1},'withdrawing evidence immediately removes its canonical facts');
    rollback;
    """
    result=subprocess.run(['docker','exec','-i','supabase_db_p11-platform','psql','-U','postgres','-X','-q','-v','ON_ERROR_STOP=1','-d',args.database],input=sql,text=True,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr[:2000])
    print(json.dumps({'propertyId':p,'adoptionAssertions':8,'passed':True,'liveDatabaseChanged':False}))


if __name__=='__main__':main()
