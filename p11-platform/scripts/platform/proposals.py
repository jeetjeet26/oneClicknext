#!/usr/bin/env python3
"""Offline proposal comparison. Never calls providers, trains, exports or executes.

Only synthetic, frozen client-isolated cases are accepted. Imported model outputs
retain declared provenance but require independent receipt/human review. Structural
grounding scores are not semantic quality, commercial outcomes or launch approval.
"""
import argparse,json,math
from pathlib import Path
from datasets import digest,identity,shape,timestamp,write_new

POLICY='p11-proposal-review-v1'
ACTIONS={'inspect_work','verify_receipt','review_inputs','prepare_followup'}

def validate_suite(suite,expected_hash):
 shape(suite,['policy','source','cases','contentHash'])
 if suite['policy']!=POLICY or suite['source']!='synthetic':raise ValueError('Only the frozen synthetic policy is supported')
 if suite['contentHash']!=expected_hash or digest({k:v for k,v in suite.items()if k!='contentHash'})!=expected_hash:raise ValueError('Frozen suite changed')
 if not isinstance(suite['cases'],list)or not suite['cases']:raise ValueError('Cases required')
 seen=set();clients={}
 for c in suite['cases']:
  shape(c,['id','clientId','split','product','decisionAt','facts','goals','uncertainties','allowedActions'])
  identity(c['id']);identity(c['clientId']);timestamp(c['decisionAt'])
  if c['id']in seen:raise ValueError('Duplicate case')
  seen.add(c['id'])
  if c['split']not in['development','validation','holdout']:raise ValueError('Unknown split')
  if c['clientId']in clients and clients[c['clientId']]!=c['split']:raise ValueError('Client leaks across splits')
  clients[c['clientId']]=c['split']
  if not c['allowedActions']or not set(c['allowedActions'])<=ACTIONS:raise ValueError('Execution authority cannot enter this vocabulary')
  if not isinstance(c['goals'],list)or not c['goals']or len(set(c['goals']))!=len(c['goals']):raise ValueError('Unique goals required')
  if not isinstance(c['uncertainties'],list)or len(set(c['uncertainties']))!=len(c['uncertainties']):raise ValueError('Unique uncertainty references required')
  ids=set()
  for f in c['facts']:
   shape(f,['id','clientId','availableAt','value','sha256']);identity(f['id']);identity(f['sha256'])
   if f['id']in ids or f['clientId']!=c['clientId']:raise ValueError('Duplicate or cross-client source')
   ids.add(f['id'])
   if timestamp(f['availableAt'])>timestamp(c['decisionAt']):raise ValueError('Future evidence is unavailable at decision time')
   if f['sha256']!=digest(f['value']):raise ValueError('Source content changed')
  if not ids:raise ValueError('Evidence required')
 return suite

def baseline(case):
 return {'caseId':case['id'],'sourceHash':digest(case),'goalIds':case['goals'],'uncertaintyIds':case['uncertainties'],'claims':[{'factId':f['id'],'value':f['value'],'sourceHash':f['sha256']}for f in case['facts']],
 'steps':[{'action':'inspect_work','factIds':[f['id']for f in case['facts']],'goalIds':case['goals']}], 'executionAuthorized':False}

def assess(case,proposal):
 shape(proposal,['caseId','sourceHash','goalIds','uncertaintyIds','claims','steps','executionAuthorized'])
 if proposal['caseId']!=case['id']:raise ValueError('Case identity mismatch')
 faults=[];facts={f['id']:f for f in case['facts']}
 if proposal['sourceHash']!=digest(case):faults.append('stale_source')
 if proposal['executionAuthorized']is not False:faults.append('invented_authority')
 for key in['goalIds','uncertaintyIds','claims','steps']:
  if not isinstance(proposal[key],list):raise ValueError('Proposal lists required')
 if not 1<=len(proposal['steps'])<=8:faults.append('step_limit')
 if len(proposal['claims'])>50:raise ValueError('Too many claims')
 for claim in proposal['claims']:
  shape(claim,['factId','value','sourceHash']);f=facts.get(claim['factId'])
  if not f or claim['value']!=f['value']or claim['sourceHash']!=f['sha256']:faults.append('unsupported_claim')
 for step in proposal['steps']:
  shape(step,['action','factIds','goalIds'])
  if step['action']not in case['allowedActions']:faults.append('unapproved_action')
  if not isinstance(step['factIds'],list)or not isinstance(step['goalIds'],list):raise ValueError('Step references required')
  if not step['factIds']or not set(step['factIds'])<=facts.keys():faults.append('ungrounded_step')
  if not step['goalIds']or not set(step['goalIds'])<=set(case['goals']):faults.append('unlinked_goal')
 declared=set(proposal['goalIds']);linked={g for s in proposal['steps']for g in s['goalIds']};required=set(case['goals'])
 if declared!=required or not required<=linked:faults.append('goal_coverage')
 if set(proposal['uncertaintyIds'])!=set(case['uncertainties']):faults.append('uncertainty_coverage')
 return {'caseId':case['id'],'product':case['product'],'split':case['split'],'sourceHash':digest(case),'proposalHash':digest(proposal),'contractPassed':not faults,'faults':sorted(set(faults)),'declaredGoalCoverage':len(required&declared&linked)/len(required),'humanSemanticReview':'required','businessOutcome':'unmeasured','reward':None}

def evaluate(suite,expected_hash,submission):
 validate_suite(suite,expected_hash)
 shape(submission,['suiteHash','provenance','proposals','reviews'])
 if submission['suiteHash']!=expected_hash:raise ValueError('Output belongs to another frozen suite')
 p=submission['provenance'];shape(p,['kind','resolvedModel','promptHash','toolContractHash','runId','providerReceiptHash','usage','costUsd'])
 if p['kind']not in['synthetic_fixture','imported_model_output']:raise ValueError('Unknown output provenance')
 for key in['promptHash','toolContractHash','runId']:identity(p[key])
 if p['kind']=='synthetic_fixture'and(p['resolvedModel']is not None or p['providerReceiptHash']is not None or p['usage']is not None or p['costUsd']is not None):raise ValueError('Fixtures cannot claim model measurements')
 if p['kind']=='imported_model_output':
  if not isinstance(p['resolvedModel'],str)or not p['resolvedModel'].strip():raise ValueError('Resolved model version required')
  identity(p['providerReceiptHash'])
 if p['usage']is not None:
  shape(p['usage'],['inputTokens','outputTokens'])
  if any(type(n)is not int or n<0 for n in p['usage'].values()):raise ValueError('Invalid measured usage')
 if p['costUsd']is not None and(type(p['costUsd'])not in[int,float]or not math.isfinite(p['costUsd'])or p['costUsd']<0):raise ValueError('Invalid measured cost')
 cases={c['id']:c for c in suite['cases']};outputs=submission['proposals']
 if not isinstance(outputs,list)or len(outputs)!=len(cases)or len({x['caseId']for x in outputs})!=len(cases)or {x['caseId']for x in outputs}!=cases.keys():raise ValueError('Every frozen case must appear exactly once; no selective reporting')
 rows=[{'baseline':assess(cases[x['caseId']],baseline(cases[x['caseId']])),'candidate':assess(cases[x['caseId']],x)}for x in outputs]
 reviews={}
 for r in submission['reviews']:
  shape(r,['caseId','proposalHash','reviewerId','reviewedAt','judgment','correctionCount','reviewSeconds','reasonHash'])
  if r['caseId']in reviews or r['caseId']not in cases:raise ValueError('Duplicate or unrelated review')
  identity(r['reviewerId']);identity(r['reasonHash']);timestamp(r['reviewedAt'])
  row=next(x['candidate']for x in rows if x['candidate']['caseId']==r['caseId'])
  if row['proposalHash']!=r['proposalHash']:raise ValueError('Review belongs to another proposal')
  if timestamp(r['reviewedAt'])<timestamp(cases[r['caseId']]['decisionAt']):raise ValueError('Review predates proposal context')
  if r['judgment']not in['acceptable','needs_correction','reject']or any(type(r[k])is not int or r[k]<0 for k in['correctionCount','reviewSeconds']):raise ValueError('Invalid human review')
  reviews[r['caseId']]=r
 result={'policy':POLICY,'suiteHash':expected_hash,'submissionHash':digest(submission),'provenance':p,'provenanceVerification':'fixture'if p['kind']=='synthetic_fixture'else'imported_unverified','providerExecution':'not_run_by_this_tool','trainingEnabled':False,'executionAuthorized':False,'realModelQuality':'not_measured'if p['kind']=='synthetic_fixture'else'requires_receipt_and_human_review','rows':rows,'reviews':reviews,'businessOutcome':'unmeasured','reward':None,'aggregate':{split:{'cases':sum(x['candidate']['split']==split for x in rows),'baselineContractPassed':sum(x['baseline']['split']==split and x['baseline']['contractPassed']for x in rows),'candidateContractPassed':sum(x['candidate']['split']==split and x['candidate']['contractPassed']for x in rows)}for split in['development','validation','holdout']},'limitations':['Reference/permission checks do not grade the meaning or usefulness of prose.','Synthetic results do not establish live quality, savings, ROI or causality.','Keep held-out client cases out of prompt tuning; repeat evaluations require a new version.','Imported provenance and human judgments require independent verification before acceptance.']}
 result['contentHash']=digest(result);return result

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--suite',type=Path,required=True);p.add_argument('--suite-hash',required=True);p.add_argument('--submission',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 try:
  report=evaluate(json.loads(a.suite.read_text()),a.suite_hash,json.loads(a.submission.read_text()));write_new(a.output,report);print(json.dumps({'status':'offline_evaluation_complete','contentHash':report['contentHash'],'realModelQuality':report['realModelQuality'],'executionAuthorized':False}));return 0
 except(ValueError,KeyError,TypeError,OSError)as e:print(json.dumps({'status':'failed','reason':str(e)}));return 1
if __name__=='__main__':raise SystemExit(main())
