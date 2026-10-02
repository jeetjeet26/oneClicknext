#!/usr/bin/env python3
"""Build versioned, metadata-only synthetic evaluation manifests. No training/export.

Production evidence requires a separately authorized, scoped server-side selection
and redaction workflow. This offline rehearsal tool deliberately rejects it.
"""
import argparse,hashlib,json,math,re
from datetime import datetime
from pathlib import Path

POLICY='p11-evaluation-metadata-v1'
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def timestamp(value):
 if not isinstance(value,str):raise ValueError('Missing observation time')
 t=datetime.fromisoformat(value.replace('Z','+00:00'))
 if t.tzinfo is None:raise ValueError('Observation time requires timezone')
 return t

def identity(value):
 if not isinstance(value,str)or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('Use a scoped pseudonymous identity, not private content')
 return value

def shape(value,required,optional=()):
 if not isinstance(value,dict)or not set(required)<=value.keys()or value.keys()-set(required)-set(optional):raise ValueError('Unexpected or missing metadata fields')

def validate_episode(row):
 shape(row,['episodeId','taskId','clientId','source','actorKind','decisionAt','context','action','allowedActions','permission','resultStatus','trainingEligible'],['receiptHash','outcome','cost'])
 for key in['episodeId','taskId','clientId']:identity(row[key])
 if row['source']!='synthetic':raise ValueError('Production selection/export is not authorized by this offline tool')
 if row['trainingEligible']is not False:raise ValueError('Synthetic qualification records cannot become training examples')
 if row['actorKind']not in['human','system','model']:raise ValueError('Unknown actor provenance')
 decision=timestamp(row['decisionAt'])
 if not isinstance(row['context'],list)or not row['context']:raise ValueError('Decision requires available context references')
 seen=set()
 for ref in row['context']:
  shape(ref,['id','clientId','sha256','availableAt']);identity(ref['id']);identity(ref['sha256'])
  if ref['id']in seen:raise ValueError('Duplicate context reference')
  seen.add(ref['id'])
  if ref['clientId']!=row['clientId']:raise ValueError('Cross-client context is not permitted')
  if timestamp(ref['availableAt'])>decision:raise ValueError('Future context would leak later information into the decision')
 if not isinstance(row['action'],str)or not re.fullmatch(r'[a-z_]+(?:\.[a-z_]+)+',row['action']):raise ValueError('Invalid semantic action')
 if not isinstance(row['allowedActions'],list)or any(not isinstance(a,str)or not re.fullmatch(r'[a-z_]+(?:\.[a-z_]+)+',a)for a in row['allowedActions']):raise ValueError('Invalid permission snapshot')
 if row['permission']not in['allowed','held','denied']:raise ValueError('Unknown permission decision')
 if row['resultStatus']not in['observed','succeeded','failed','unconfirmed','cancelled']:raise ValueError('Unknown result provenance')
 if row.get('receiptHash')is not None:identity(row['receiptHash'])
 if row['resultStatus']=='succeeded'and not row.get('receiptHash'):raise ValueError('Success requires its own result evidence')
 if 'outcome'in row:
  o=row['outcome'];shape(o,['status','measuredAt','evidenceHash'],['metricVersion','value','unit'])
  if o['status']not in['pending','observed','unattributed']:raise ValueError('Unknown outcome maturity')
  if timestamp(o['measuredAt'])<decision:raise ValueError('An earlier measurement is context, not a later outcome')
  identity(o['evidenceHash'])
  if 'value'in o and(type(o['value'])not in[int,float]or not math.isfinite(o['value'])):raise ValueError('Outcome measurements must be finite and explicitly sourced')
  if 'value'in o and(not o.get('metricVersion')or not o.get('unit')):raise ValueError('Measured outcomes require a definition and unit')
 if 'cost'in row:
  c=row['cost'];shape(c,['amount','unit','source'])
  if c['amount']is not None and(type(c['amount'])not in[int,float]or not math.isfinite(c['amount'])or c['amount']<0):raise ValueError('Invalid measured cost')
  if c['source']!='fixture'or c['unit']not in['USD','tokens']:raise ValueError('Synthetic costs require explicit fixture provenance')
 return row

def manifest(episodes,cutoff):
 end=timestamp(cutoff)
 if not isinstance(episodes,list)or not episodes:raise ValueError('No selected episodes')
 ids=set();tasks={};rows=[]
 for row in episodes:
  validate_episode(row)
  if row['episodeId']in ids:raise ValueError('Duplicate episode identity')
  ids.add(row['episodeId'])
  if row['taskId']in tasks and tasks[row['taskId']]!=row['clientId']:raise ValueError('A task cannot span client boundaries')
  tasks[row['taskId']]=row['clientId']
  if timestamp(row['decisionAt'])>end:raise ValueError('Episode is outside the frozen selection cutoff')
  if 'outcome'in row and timestamp(row['outcome']['measuredAt'])>end:raise ValueError('Outcome is outside the frozen snapshot cutoff')
  bucket=int(hashlib.sha256(('p11-heldout-v1:'+row['clientId']).encode()).hexdigest()[:8],16)%10
  split='holdout'if bucket==9 else'validation'if bucket in[7,8]else'development'
  violation=row['permission']!='allowed'or row['action']not in row['allowedActions']
  rows.append({'episodeId':row['episodeId'],'taskId':row['taskId'],'clientId':row['clientId'],'split':split,'actorKind':row['actorKind'],'decisionAt':row['decisionAt'],'decisionInputHash':digest({k:row[k]for k in['clientId','context','decisionAt','allowedActions','permission']}),'action':row['action'],'recordHash':digest(row),'resultStatus':row['resultStatus'],'policyViolation':violation,'trainingEligible':False,'reward':None,'outcomeMaturity':row.get('outcome',{}).get('status','unobserved'),'cost':row.get('cost',{'amount':None,'unit':'USD','source':'fixture'})})
 # Input/context hashes exclude actions and all later results/outcomes. The full
 # record hash changes when corrected evidence arrives, yielding a new version.
 result={'formatVersion':1,'policyVersion':POLICY,'purpose':'synthetic_evaluation_rehearsal','cutoff':cutoff,'splitUnit':'client','splitPolicy':'p11-heldout-v1','trainingEnabled':False,'modelQuality':'not_measured','episodes':sorted(rows,key=lambda x:x['episodeId'])}
 result['contentHash']=digest(result);return result

def freeze_baseline(root,files,dataset):
 if dataset.get('contentHash')!=digest({k:v for k,v in dataset.items()if k!='contentHash'}):raise ValueError('Dataset manifest changed')
 if dataset.get('policyVersion')!=POLICY or dataset.get('trainingEnabled')is not False:raise ValueError('Unknown dataset governance')
 entries=[]
 for name in sorted(set(files)):
  base=root.resolve();original=base/name;p=original.resolve()
  if Path(name).is_absolute()or not p.is_relative_to(base)or any(x.is_symlink()for x in [original,*original.parents]if x.is_relative_to(base))or not p.is_file():raise ValueError('Baseline source is outside the project')
  entries.append({'file':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 if not entries:raise ValueError('Baseline needs exact source contracts')
 result={'formatVersion':1,'strategy':'existing_models_with_product_tools_and_grounded_context','trainingEnabled':False,'datasetHash':dataset['contentHash'],'sourceContracts':entries,'providerExecution':'not_run','modelQuality':'not_measured','runRequirements':['Use an explicitly authorized provider/model and capture its resolved version.','Keep held-out client/task episodes out of development and prompt tuning.','Record exact prompt/context/tool-contract hashes, results, receipts, measured usage and cost.','Assess policy, execution quality and later business outcomes separately.','No production training selection or cross-client reuse is authorized by this manifest.']}
 result['contentHash']=digest(result);return result

def write_new(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 with path.open('x')as f:f.write(json.dumps(value,indent=2)+'\n')

def main():
 p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
 a=s.add_parser('manifest');a.add_argument('--episodes',type=Path,required=True);a.add_argument('--cutoff',required=True);a.add_argument('--output',type=Path,required=True)
 a=s.add_parser('baseline');a.add_argument('--root',type=Path,required=True);a.add_argument('--files',type=Path,required=True);a.add_argument('--dataset',type=Path,required=True);a.add_argument('--output',type=Path,required=True)
 a=p.parse_args()
 try:
  value=manifest(json.loads(a.episodes.read_text()),a.cutoff)if a.command=='manifest'else freeze_baseline(a.root,json.loads(a.files.read_text()),json.loads(a.dataset.read_text()))
  write_new(a.output,value);print(json.dumps({'status':'prepared_not_executed','contentHash':value['contentHash'],'trainingEnabled':False}));return 0
 except(ValueError,OSError,KeyError,TypeError)as e:print(json.dumps({'status':'failed','reason':str(e)}));return 1
if __name__=='__main__':raise SystemExit(main())
