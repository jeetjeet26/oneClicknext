"""Prepare an auditable, atomic legacy-to-Brain adoption; never connects to a DB.

Inputs are a private, current DB snapshot and separately reviewed public facts.
Output SQL contains the private rollback snapshot and must not be committed.
The generated transaction refuses concurrent edits and is idempotent by receipt.
It does not fabricate embeddings, extraction receipts, or asset rights.
"""
import argparse
import hashlib
import json
import re
import uuid
from pathlib import Path


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def js(value):
    return literal(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) + '::jsonb'


def fact_payload(source, review, evidence):
    fields = {'community': 'short_description', 'features': 'features_detail',
              'faq': 'faqs', 'plan2': 'structured_facts', 'commercial_hold': 'restricted_claims'}
    field = source.get('canonicalField') or fields.get(source['key'])
    if field not in set(fields.values()):
        raise ValueError('Select a supported canonical field for this adoption source')
    lines = []
    for key, value in source['facts'].items():
        label = re.sub(r'(?<!^)(?=[A-Z])', ' ', key).capitalize()
        rendered = '; '.join(map(str, value)) if isinstance(value, list) else str(value)
        lines.append(label + ': ' + rendered)
    value = '\n'.join(lines)
    if not value or len(value) > 8000 or len(source['title']) > 200:
        raise ValueError('Canonical fact exceeds the editor limits')
    url = source['sourceUrl']
    return field, {'field': field, 'value': value, 'source': source['title'],
                   'sourceUrl': url if url.startswith(('https://', 'http://')) else '',
                   'observedAt': source['capturedAt'][:10],
                   'effectiveFrom': review['reviewedAt'][:10], 'effectiveTo': None,
                   'reviewAfter': review['reviewAfter'][:10], 'confidence': None,
                   'origin': 'staff' if url.startswith('operator:') else 'import',
                   'visibility': 'public', 'sourceEvidenceId': evidence,
                   'sourceHash': source['sourceHash']}


def prepare(snapshot, review):
    pid = str(uuid.UUID(review['propertyId']))
    actor = str(uuid.UUID(review['actorId']))
    if snapshot['property']['id'] != pid or snapshot['context']['property_id'] != pid:
        raise ValueError('Snapshot community mismatch')
    for key in ('units', 'sources', 'documents'):
        if any(row['property_id'] != pid for row in snapshot[key]):
            raise ValueError('Snapshot contains another community')
    if review['commercialPolicy'] != 'unconfirmed_refer_to_sales':
        raise ValueError('This adoption recipe requires a commercial-information hold')
    if not review['sources'] or len(review['sources']) > 20:
        raise ValueError('Review a bounded set of original sources')
    org = str(uuid.UUID(snapshot['property']['org_id']))
    snapshot_hash = digest(json.dumps(snapshot, sort_keys=True, separators=(',', ':')))
    review_hash = digest(json.dumps(review, sort_keys=True, separators=(',', ':')))
    receipt = str(uuid.uuid5(uuid.UUID(pid), 'brain-adoption:' + snapshot_hash + review_hash))
    sql = ['begin;', 'set local lock_timeout=\'5s\';', 'do $adopt$ declare actual jsonb;begin',
           f"perform pg_advisory_xact_lock(hashtextextended('{pid}',915));",
           f"if exists(select 1 from public.community_adoption_receipts where id='{receipt}')then return;end if;",
           f"if not public.brain_can('{actor}','{pid}','manage')then raise insufficient_privilege;end if;"]
    # Compare complete row snapshots, not just timestamps that a legacy writer may omit.
    for table, row in [('properties', snapshot['property']), ('property_chatbot_contexts', snapshot['context'])] + [('property_units', r) for r in snapshot['units']]:
        sql += [f"select to_jsonb(t)into actual from public.{table} t where id='{row['id']}' for update;",
                f"if actual is distinct from {js(row)} then raise exception 'Concurrent change in {table}; recapture and review';end if;"]
    for table, rows in [('knowledge_sources', snapshot['sources']), ('documents', snapshot['documents'])]:
        subtract = "-'embedding'-'evidence_id'-'embedding_model'-'embedding_recipe'-'search_text'" if table == 'documents' else ''
        sql += [f"select coalesce(jsonb_agg(to_jsonb(t){subtract} order by t.id),'[]')into actual from public.{table} t where property_id='{pid}';",
                f"if actual is distinct from {js(sorted(rows, key=lambda r: r['id']))} then raise exception 'Concurrent source change in {table}; recapture and review';end if;"]
    sql += [f"if exists(select 1 from public.assistant_fact_workspaces where property_id='{pid}')then raise exception 'Reviewed assistant workspace requires a separate adoption';end if;",
            f"if exists(select 1 from public.property_intelligence_documents where property_id='{pid}' and kind='fact' and status='approved')then raise exception 'Existing canonical facts require reconciliation';end if;"]
    sources = []
    fact_fields = set()
    for source in review['sources']:
        body = source['content'].strip()
        if not body or len(body) > 6000 or len(source['sourceHash']) != 64:
            raise ValueError('Reviewed source is missing provenance or exceeds its bound')
        material = str(uuid.uuid5(uuid.UUID(receipt), 'material:' + source['key']))
        version = str(uuid.uuid5(uuid.UUID(material), digest(body)))
        evidence = str(uuid.UUID(hashlib.md5(('material:' + version).encode()).hexdigest()))
        chunk = str(uuid.UUID(hashlib.md5((evidence + ':1').encode()).hexdigest()))
        fact = str(uuid.uuid5(uuid.UUID(version), 'canonical'))
        source_input = {'recipe': 'reviewed-community-adoption-v1', 'receiptId': receipt,
                        'sourceUrl': source['sourceUrl'], 'sourceHash': source['sourceHash'],
                        'capturedAt': source['capturedAt'], 'reviewReason': source['reason']}
        purposes = "array['chat','site','social','brand','research','portfolio']"
        after = literal(review['reviewAfter']) + '::timestamptz'
        sql += [f"perform set_config('p11.knowledge_scope','{material}',true);",
                f"insert into public.knowledge_materials(id,property_id,org_id,created_by)values('{material}','{pid}','{org}','{actor}');",
                f"insert into public.knowledge_material_versions(id,material_id,property_id,org_id,actor_id,title,content,content_hash,input)values('{version}','{material}','{pid}','{org}','{actor}',{literal(source['title'])},{literal(body)},'{digest(body)}',{js(source_input)});",
                f"insert into public.community_source_reviews(version_id,property_id,actor_id,audience,origin,allowed_uses,purposes,review_after,reason)values('{version}','{pid}','{actor}','public','original',array['fact'],{purposes},{after},{literal(source['reason'])});",
                f"update public.knowledge_materials set latest_version_id='{version}',active_version_id='{version}' where id='{material}';",
                f"insert into public.community_evidence(id,property_id,org_id,material_version_id,authority,audience,purposes,allowed_uses,content_hash,review_status,review_after,origin)values('{evidence}','{pid}','{org}','{version}','reviewed','public',{purposes},array['fact'],'{digest(body)}','approved',{after},'original');",
                f"insert into public.documents(id,property_id,content,evidence_id,metadata)values('{chunk}','{pid}',{literal(body)},'{evidence}',{js({**source_input,'knowledge_material_id':material,'version_id':version,'title':source['title'],'source':'reviewed_adoption','chunk_index':0})});"]
        field, payload = fact_payload(source, review, evidence)
        if field in fact_fields:
            raise ValueError('Each reviewed adoption fact must have a distinct editor field')
        fact_fields.add(field)
        sql += [f"insert into public.property_intelligence_documents(id,property_id,org_id,kind,key,payload,status,actor_id)values('{fact}','{pid}','{org}','fact',{literal(field)},{js(payload)},'approved','{actor}');"]
        sources.append({'key':source['key'],'materialId':material,'versionId':version,'evidenceId':evidence,'sourceHash':source['sourceHash']})
    # Untested legacy extractions must not leak through canonical property/unit fields.
    # The originals remain in the receipt and source records for later reconciliation.
    sql += [f"update public.properties set amenities='{{}}'::text[],pet_policy=null,parking_info='{{}}'::jsonb,office_hours='{{}}'::jsonb where id='{pid}';",
            f"update public.property_units set review_status='pending',expires_at=clock_timestamp(),last_updated_at=clock_timestamp() where property_id='{pid}' and active;"]
    safe_text = review['safeLegacyContext']
    sql += [f"update public.property_chatbot_contexts set context_markdown={literal(safe_text)},context_json={js({'adoptionReceiptId':receipt,'commercialPolicy':review['commercialPolicy'],'sources':sources})},status='current',requires_review=false,version=version+1,stale_at=null,error_message=null,last_generated_at=clock_timestamp(),updated_at=clock_timestamp(),last_change_summary='Verified Community Brain adoption; availability, pricing and incentives unconfirmed. Contact sales.' where property_id='{pid}';"]
    manifest = {'recipe':'reviewed-community-adoption-v1','reviewHash':review_hash,'sources':sources,
                'legacySourcesRetained':len(snapshot['sources']),'legacyChunksRetained':len(snapshot['documents']),
                'commercialPolicy':review['commercialPolicy'],'before':snapshot,
                'reviewAfter':review['reviewAfter'],'activation':'separate_audited_rollout'}
    sql += [f"insert into public.community_adoption_receipts(id,property_id,actor_id,source_snapshot_hash,manifest)values('{receipt}','{pid}','{actor}','{snapshot_hash}',{js(manifest)});",
            'end $adopt$;', 'commit;']
    public_manifest = {k:v for k,v in manifest.items() if k != 'before'}
    return '\n'.join(sql)+'\n', {'receiptId':receipt,'propertyId':pid,'snapshotHash':snapshot_hash,**public_manifest}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',type=Path,required=True)
    parser.add_argument('--review',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    sql,manifest=prepare(json.loads(args.snapshot.read_text()),json.loads(args.review.read_text()))
    args.output.write_text(sql);args.output.chmod(0o600)
    args.output.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'receiptId':manifest['receiptId'],'sources':len(manifest['sources']),'sqlPrepared':True,'databaseChanged':False}))


if __name__=='__main__':
    main()
