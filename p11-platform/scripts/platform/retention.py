#!/usr/bin/env python3
"""Plan retention from scoped metadata and retain deletion lineage. No hosted writes.

This module is an offline review tool, not a production erasure executor. Storage,
database, provider and backup receipts remain separate obligations.
"""
import argparse, json
from pathlib import Path
from datasets import digest, identity, shape, timestamp, write_new

KINDS={'original','extraction','source','embedding','context','event','artifact','report','dataset','provider_copy','backup'}

def plan(inventory,client_id,selected,reviewed_at):
    identity(client_id); now=timestamp(reviewed_at)
    shape(inventory,['formatVersion','source','records'])
    if inventory['formatVersion']!=1 or inventory['source'] not in ['synthetic','production_metadata']:
        raise ValueError('Unknown inventory provenance')
    rows={}
    for row in inventory['records']:
        shape(row,['id','clientId','kind','sha256','state','references','hold'],['retainUntil'])
        identity(row['id']);identity(row['clientId']);identity(row['sha256'])
        if row['id']in rows:raise ValueError('Duplicate retained identity')
        if row['kind']not in KINDS or row['state']not in ['active','withdrawn','erased'] or type(row['hold'])is not bool:
            raise ValueError('Unknown retention state')
        if not isinstance(row['references'],list):raise ValueError('Invalid lineage')
        for ref in row['references']:identity(ref)
        if row.get('retainUntil'):timestamp(row['retainUntil'])
        rows[row['id']]=row
    selected=set(selected)
    if not selected or not selected<=rows.keys():raise ValueError('Select exact retained records')
    if any(rows[x]['clientId']!=client_id for x in selected):raise ValueError('Cross-client erasure scope')
    affected=set(selected);pending=list(selected)
    # Descendants include copies, embeddings and frozen datasets; no unrelated
    # client is silently added to the operation when a bad historical link exists.
    while pending:
        parent=pending.pop()
        for row in rows.values():
            if parent in row['references']and row['id']not in affected:
                if row['clientId']!=client_id:raise ValueError('Cross-client retained descendant requires investigation')
                affected.add(row['id']);pending.append(row['id'])
    blockers=[];targets=[]
    for key in sorted(affected):
        row=rows[key]
        if row['hold']:blockers.append({'id':key,'reason':'explicit_retention_hold'})
        if row.get('retainUntil')and timestamp(row['retainUntil'])>now:blockers.append({'id':key,'reason':'retention_period_not_elapsed'})
        if row['state']=='active':blockers.append({'id':key,'reason':'withdraw_or_stop_active_use_before_erasure'})
        if any(ref not in rows for ref in row['references']):blockers.append({'id':key,'reason':'incomplete_lineage_inventory'})
        targets.append({'id':key,'kind':row['kind'],'sha256':row['sha256'],'state':row['state']})
    value={'formatVersion':1,'purpose':'retention_review','source':inventory['source'],'clientId':client_id,
           'reviewedAt':reviewed_at,'inventoryHash':digest(inventory),'selection':sorted(selected),'targets':targets,
           'blockers':blockers,'execution':'not_authorized_by_this_plan','trainingEligible':False,
           'requiredSteps':['Fence all active writers and queued/running work for this exact scope.',
               'Re-read the full scoped inventory and compare its hash immediately before execution.',
               'Delete original bytes through the Storage API; database metadata deletion does not delete bytes.',
               'Remove or redact copied text, embeddings, snapshots, reports, action payloads and datasets within scope.',
               'Retain minimal deletion receipts outside the erased property; enforce them before reopening restored backups.',
               'Track provider copies and backup expiry separately; do not claim whole-scope erasure while any remain.']}
    value['contentHash']=digest(value);return value

def finish(review,inventory,receipts):
    if review.get('contentHash')!=digest({k:v for k,v in review.items()if k!='contentHash'}):raise ValueError('Retention review changed')
    if digest(inventory)!=review['inventoryHash']:raise ValueError('Retained inventory changed after review')
    if review['blockers']:raise ValueError('Retention blockers remain')
    expected={r['id']:r for r in review['targets']};observed={}
    for receipt in receipts:
        shape(receipt,['id','sha256','kind','state','observedAt','receiptHash'])
        identity(receipt['receiptHash']);timestamp(receipt['observedAt'])
        if receipt['id']in observed or receipt['id']not in expected:raise ValueError('Unexpected or duplicate erasure receipt')
        row=expected[receipt['id']]
        if receipt['sha256']!=row['sha256']or receipt['kind']!=row['kind']or receipt['state']!='erased':raise ValueError('Erasure remains unconfirmed')
        if timestamp(receipt['observedAt'])<timestamp(review['reviewedAt']):raise ValueError('Stale erasure receipt')
        observed[receipt['id']]=receipt
    if observed.keys()!=expected.keys():raise ValueError('Originals, copies, providers or backups still lack receipts')
    value={'formatVersion':1,'source':review['source'],'clientId':review['clientId'],'reviewHash':review['contentHash'],
           'erasedIds':sorted(expected),'receipts':sorted(receipts,key=lambda x:x['id']),
           'trainingEligible':False,'restoreRequirement':'Apply this exclusion before serving any restored snapshot.',
           'verification':'Recorded receipts; independently verify the executor and its destination.'}
    value['contentHash']=digest(value);return value

def exclude_erased(episodes,tombstones):
    excluded={}
    for t in tombstones:
        if t.get('contentHash')!=digest({k:v for k,v in t.items()if k!='contentHash'}):raise ValueError('Deletion lineage changed')
        client=identity(t['clientId']);excluded.setdefault(client,set()).update(identity(x)for x in t['erasedIds'])
    kept=[];removed=[]
    for row in episodes:
        refs={row['episodeId'],row['taskId'],*[c['id']for c in row['context']]}
        if refs&excluded.get(row['clientId'],set()):removed.append(row['episodeId'])
        else:kept.append(row)
    return {'episodes':kept,'removedEpisodeIds':sorted(removed),'tombstoneHashes':sorted(t['contentHash']for t in tombstones),
            'previousFrozenDatasets':'Must be marked invalidated separately; never silently overwrite an earlier baseline.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    q=s.add_parser('plan');q.add_argument('--inventory',type=Path,required=True);q.add_argument('--client',required=True);q.add_argument('--selected',type=Path,required=True);q.add_argument('--reviewed-at',required=True);q.add_argument('--output',type=Path,required=True)
    q=s.add_parser('finish');q.add_argument('--review',type=Path,required=True);q.add_argument('--inventory',type=Path,required=True);q.add_argument('--receipts',type=Path,required=True);q.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    try:
        read=lambda f:json.loads(f.read_text())
        value=plan(read(a.inventory),a.client,read(a.selected),a.reviewed_at)if a.command=='plan'else finish(read(a.review),read(a.inventory),read(a.receipts))
        write_new(a.output,value);print(json.dumps({'state':'recorded_review_only','contentHash':value['contentHash']}));return 0
    except(ValueError,KeyError,TypeError,OSError)as e:print(json.dumps({'state':'needs_review','reason':str(e)}));return 1
if __name__=='__main__':raise SystemExit(main())
