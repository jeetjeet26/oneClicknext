#!/usr/bin/env python3
"""Produce a per-action evidence map from the current schema and repository.

This is static traceability, not proof that every possible user action is captured.
Runtime qualification and observed operation are separate, explicit evidence.
"""
import argparse,hashlib,json,re
from collections import defaultdict
from pathlib import Path

PREFIX={'agency':'agency','audit':'propertyaudit','bi':'bi','brand':'brandforge','calendar':'integrations','checklist':'property','console':'platform','crm':'crm','email':'integrations','integration':'integrations','knowledge':'knowledge','lead':'leadpulse','legal':'property','luma':'lumaleasing','market':'marketvision','neighborhood':'property','organization':'property','pipeline':'pipelines','property':'property','readiness':'property','review':'reviewflow','settings':'settings','site':'siteforge','studio':'forgestudio','team':'team','tour':'tourspark','workflow':'tourspark'}
# Reviewed two-stage command construction (for example studio. + asset. + saved).
# Function body hashes in the output invalidate stale evidence when code changes.
COMPOSED={**dict.fromkeys(['review.batch.approved','review.batch.recovered','review.batch.stopped'],'decide_reviewflow_batch'),
 **dict.fromkeys(['review.intake.rebased','review.intake.recovered','review.intake.stopped'],'control_reviewflow_intake'),
 **dict.fromkeys(['studio.app_configuration.disable','studio.app_configuration.save'],'save_forgestudio_social_config'),
 **dict.fromkeys(['studio.asset.archived','studio.asset.restored','studio.asset.reviewed','studio.asset.saved'],'manage_forgestudio_asset'),
 **dict.fromkeys(['studio.publication.cancel','studio.publication.reschedule'],'control_forgestudio_publication')}
def sha(value):return hashlib.sha256(value).hexdigest()
def registered(functions):
 result=set()
 for fn in functions:
  for m in re.finditer(r'\bp_action\s+(?:not\s+)?in\s*\(([^)]+)\)',fn['source'],re.I):
   result.update(x for x in re.findall(r"'([a-z][a-z0-9_.]+)'",m[1])if'.'in x and not x.endswith('.'))
 return result

def generate(root,functions):
 catalog=root/'apps/web/utils/actions/catalog.ts';source=catalog.read_text().split('export const ACTION_LABELS',1)[1]
 labels=dict(re.findall(r"['\"]([a-z0-9_.]+)['\"]\s*:\s*['\"]([^'\"]+)['\"]",source));actions=registered(functions)|set(labels)
 byname={x['name']:x for x in functions};callers=defaultdict(set)
 for fn in functions:
  for callee in re.findall(r'\b(?:public|private)\.([a-z_][a-z0-9_]*)\s*\(',fn['source']):
   callers[callee].add(fn['name'])
 # Resolve native call paths to the actual shared event writers. Wrapper functions
 # need not mention the shared table directly. This remains conservative static evidence.
 writers={fn['name']for fn in functions if re.search(r'insert\s+into\s+public\.shared_action_events',fn['source'],re.I)}
 queue=list(writers)
 while queue:
  for caller in callers[queue.pop()]-writers:
   writers.add(caller);queue.append(caller)
 files=[]
 for folder in ['apps/web/app','apps/web/utils','apps/web/components','apps/web/e2e','supabase/tests','supabase/rehearsals','services/data-engine','services/mcp-servers']:
  for path in (root/folder).rglob('*'):
   rel=path.relative_to(root)
   if not path.is_file()or path.suffix not in('.ts','.tsx','.sql','.py')or any(x.startswith('.')or x in('node_modules','__pycache__','venv')for x in rel.parts):continue
   text=path.read_text();files.append((str(rel),text,sha(path.read_bytes()),set(re.findall(r'[a-z_][a-z0-9_]*',text))))
 rows=[]
 for action in sorted(actions):
  literal="'"+action+"'"
  seeds={fn['name']for fn in functions if literal in fn['source'] and fn['name']!='append_shared_action_event' and fn['name']in writers}
  # Several products share a recorder that prefixes a validated command kind.
  # Resolve that exact literal prefix plus an upstream literal suffix; never
  # infer a recorder merely because its product name resembles the action.
  for offset in [m.end()for m in re.finditer(r'\.',action)]:
   prefix,suffix=action[:offset],action[offset:]
   dynamic={fn['name']for fn in functions if fn['name']in writers and re.search(re.escape("'"+prefix+"'")+r'\s*\|\|',fn['source'])}
   parents=set(dynamic);pending=list(dynamic)
   while pending:
    for parent in callers[pending.pop()]-parents:
     parents.add(parent);pending.append(parent)
   seeds.update(n for n in parents if "'"+suffix+"'"in byname[n]['source'])
  if action in COMPOSED:
   name=COMPOSED[action]
   if name not in writers:raise ValueError('Reviewed action no longer reaches its recorder: '+action)
   seeds.add(name)
  reachable=set(seeds);queue=list(seeds)
  while queue:
   for caller in callers[queue.pop()]-reachable:
    reachable.add(caller);queue.append(caller)
  sites=[];tests=[]
  for path,text,digest,identifiers in files:
   if path.endswith('/utils/actions/catalog.ts'):continue
   direct=action in text;native=sorted(reachable & identifiers)
   if not direct and not native:continue
   entry={'file':path,'sha256':digest,'reference':'action_literal'if direct else'native_call_path','nativeFunctions':native}
   is_test='/tests/'in path or'/rehearsals/'in path or'/e2e/'in path or'.test.'in path
   if is_test:
    entry['executionGate']='separate_approval_pending'if path.endswith('/reviewflow_responses.test.sql')else'isolated_execution_rehearsal_only'if'/rehearsals/'in path else'requires_matching_run_evidence';tests.append(entry)
   else:sites.append(entry)
  rows.append({'action':action,'label':labels.get(action),'product':PREFIX.get(action.split('.')[0],'unclassified'),'trainingEligible':False,'evidenceClass':'browser_observation'if action=='console.page.viewed'else'semantic_action_reference','nativeRecorders':[{'identity':byname[n]['identity'],'bodyHash':sha(byname[n]['source'].encode())}for n in sorted(seeds)],'captureReferences':sites,'testReferences':tests,'mappingStatus':'references_found'if(seeds or(action=='console.page.viewed'and sites))and tests else'requires_manual_mapping','qualification':'Static references require journey-level outcome/recovery evidence; not a completeness certificate.'})
 result={'formatVersion':1,'scope':'retained action names and exact current source references','trainingEnabled':False,'actions':rows,'limitations':['Dynamic action construction needs reviewed mapping.','Historical display labels may remain after a workflow is retired.','References do not prove an assertion covers every branch or that a provider accepted an action.','Browser observations can be interrupted and cannot prove business success.']}
 result['contentHash']=sha(json.dumps(result,sort_keys=True,separators=(',',':')).encode());return result

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--functions',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();result=generate(a.root,json.loads(a.functions.read_text()));a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'actions':len(result['actions']),'manualMapping':sum(x['mappingStatus']=='requires_manual_mapping'for x in result['actions']),'contentHash':result['contentHash']}))
if __name__=='__main__':main()
