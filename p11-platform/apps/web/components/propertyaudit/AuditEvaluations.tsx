"use client"
import {useEffect,useRef,useState} from 'react'
import type {AuditDecisionController} from '@/utils/propertyaudit/use-audit-decisions'
import {pendingEvaluation} from '@/utils/propertyaudit/evaluation-contracts'
import {auditButton,auditField} from './AuditDecisionHistory'
import {AuditEvidence} from './AuditWorkspaceControls'
type Row=Record<string,unknown>
type RecordValue={id:string;actor_id:string;state:string;source_hash:string;preview_hash:string|null;evaluator_version:string;created_at:string;source:{run:Row;answers:Array<{answer:Row}>;scores:Row[]};preview:{coverage:Row;aggregate:Row;answers:Array<Row>}|null}
type Reply={id?:string;actorId?:string;propertyId:string;canManage?:boolean;canResume?:boolean;record?:RecordValue;source?:Row;sourceHash?:string;items?:Array<Row>;count?:number;hash?:string;offset?:number;status?:string}
type Pending={id:string;kind:'prepare'|'decision'}
export function AuditEvaluations({runId,controller:c}:{runId:string;controller:AuditDecisionController}){
 const propertyId=c.context?.property.id||'', actor=c.actor, key=`p11.audit-evaluation:${actor}:${propertyId}`, abort=useRef<AbortController|null>(null),lock=useRef(false)
 const [page,setPage]=useState<Reply|null>(null),[record,setRecord]=useState<RecordValue|null>(null),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState('')
 async function request(input:Row,method='GET'):Promise<Reply>{
  const signal=abort.current?.signal
  const response=await fetch('/api/propertyaudit/evaluations'+(method==='GET'?'?'+new URLSearchParams(Object.entries({...input,propertyId}).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)])):''),{method,cache:'no-store',signal,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,propertyId,expectedActorId:actor})}:{})}),data=await response.json()
  signal?.throwIfAborted()
  if(!response.ok)throw new Error(data.error||'Saved evaluation unavailable.')
  if(data.propertyId!==propertyId||(method==='GET'&&data.actorId!==actor)||(method==='POST'&&data.id!==input.id))throw new Error('Evaluation does not match the current account, property or request.')
  return data
 }
 async function work(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){if(!abort.current?.signal.aborted)setError(e instanceof Error?e.message:'Evaluation unavailable.')}finally{lock.current=false;if(!abort.current?.signal.aborted)setBusy(false)}}
 async function load(offset=0,hash?:string){setPage(await request({runId,offset,hash}))}
 async function open(id:string){const data=await request({id});setRecord(data.record!);setReason('');return data}
 function remember(value:Pending){sessionStorage.setItem(key,JSON.stringify(value));setPending(value)}
 function settled(){sessionStorage.removeItem(key);setPending(null)}
 useEffect(()=>{
  if(!propertyId||!actor)return
  const controller=new AbortController();abort.current=controller
  setBusy(true);setError('')
  void (async()=>{const raw=sessionStorage.getItem(key);if(raw){const parsed=pendingEvaluation.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('The browser request cannot be read. Keep this tab and contact your administrator.');setPending(parsed.data)}await load()})().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Evaluation unavailable.')}).finally(()=>{if(!controller.signal.aborted)setBusy(false)})
  return()=>controller.abort()
  // Each run/account instance owns its request and retained identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[propertyId,actor,runId])
 async function prepare(){if(!page?.sourceHash)return;const id=crypto.randomUUID();remember({id,kind:'prepare'});const result=await request({operation:'prepare',id,runId,sourceHash:page.sourceHash},'POST');settled();await open(id);await load();setNotice(result.status==='cancelled'?'Unused request cancelled.':'Evaluation saved for review. Scores have not changed.')}
 async function recover(){if(!pending)return;if(pending.kind==='prepare'){await open(pending.id);settled();await load();setNotice('Saved evaluation recovered. No measurement was repeated.')}else{const result=await request({commandId:pending.id});settled();await load();c.changed();setNotice(`Saved decision recovered: ${result.status||'saved'}.`)}}
 async function cancel(){if(!pending)return;const result=await request({operation:pending.kind==='prepare'?'cancel':'cancel_decision',id:pending.id},'POST');settled();await load();setNotice(`Request closed: ${result.status||'cancelled'}.`)}
 async function resume(){if(!record)return;remember({id:record.id,kind:'prepare'});await request({operation:'resume',id:record.id},'POST');settled();await open(record.id);await load();setNotice('Saved source recalculated for review. No provider was called.')}
 async function decide(operation:'apply'|'discard'){if(!record)return;const id=crypto.randomUUID();remember({id,kind:'decision'});await request({id,operation,evaluationId:record.id,previewHash:record.preview_hash,reason},'POST');settled();await open(record.id);await load();c.changed();setNotice(operation==='apply'?'Reviewed evaluation applied. Original evidence and earlier values remain in history. This does not establish a business improvement.':'Evaluation discarded; saved evidence remains available.')}
 const enabled=c.canManage&&page?.canManage&&!busy&&!pending,eligible=page?.source&&((page.source.run as Row)?.status==='completed')
 return <section aria-label="Saved audit re-evaluations" className="space-y-3 rounded-xl border border-border bg-background p-4">
  <h3 className="font-semibold">Review recalculated scores</h3><p className="text-sm text-muted-foreground">Recalculate retained answers using their original property facts and questions. Preview changes before applying them. This makes no model calls and does not verify a business improvement.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {pending&&<div className="space-y-2 rounded border border-amber-400 p-3 text-sm"><p>A request may already be saved. Check it before starting another evaluation.</p><div className="flex flex-wrap gap-2"><button className={auditButton} disabled={busy} onClick={()=>void work(recover)}>Check saved evaluation request</button><button className={auditButton} disabled={busy} onClick={()=>void work(cancel)}>Cancel unused evaluation request</button></div></div>}
  <div className="flex flex-wrap gap-2"><button className={auditButton} disabled={!enabled||!eligible} onClick={()=>void work(prepare)}>Prepare score preview</button><button className={auditButton} disabled={busy} onClick={()=>void work(()=>load())}>Refresh evaluations</button></div>
  {!eligible&&<p className="text-sm text-muted-foreground">A completed run with retained answers and original context is required.</p>}
  <h4 className="text-sm font-medium">Saved evaluations ({page?.count??0})</h4><ol className="space-y-2">{page?.items?.map(item=><li key={String(item.id)}><button className={`${auditButton} w-full text-left`} disabled={busy} onClick={()=>void work(()=>open(String(item.id)).then(()=>{}))}>{String(item.state)} · {new Date(String(item.created_at)).toLocaleString()}</button></li>)}</ol>
  <div className="flex gap-2 text-sm"><button className={auditButton} disabled={busy||!page?.offset} onClick={()=>void work(()=>load(Math.max(0,(page?.offset||0)-25),page?.hash))}>Previous evaluations</button><button className={auditButton} disabled={busy||(page?.offset||0)+25>=(page?.count||0)} onClick={()=>void work(()=>load((page?.offset||0)+25,page?.hash))}>Next evaluations</button></div>
  {record&&<div className="space-y-3 rounded-lg border border-border p-3"><h4 className="font-medium">Saved evaluation detail · {record.state}</h4>{record.source?.run?.measurement_mode==='local_fixture'&&<p className="text-sm text-amber-700">Synthetic local evidence</p>}
   {record.preview&&<><p className="text-sm">Saved score before review: {String(record.source.scores[0]?.overall_score??'Unknown')} · Recalculated score: {String(record.preview.aggregate.overall_score)}</p><p className="text-sm">{String(record.preview.coverage.evaluatedAnswers)} answers evaluated / {String(record.preview.coverage.capturedExecutions)} captured executions. Missing answers are not negative answers.</p><div className="max-h-80 overflow-auto"><table className="w-full min-w-[520px] text-xs [&_th]:px-2 [&_td]:px-2"><thead><tr><th className="p-2 text-left">Original question</th><th>Presence before</th><th>Presence after</th><th>Recalculated score</th></tr></thead><tbody>{record.preview.answers.map(a=><tr key={String(a.id)}><td className="p-2">{String((a.question as Row)?.text||'Unknown')}</td><td>{record.source.answers.find(x=>x.answer.id===a.id)?.answer.presence?'Yes':'No'}</td><td>{a.presence?'Yes':'No'}</td><td>{String(a.score)}</td></tr>)}</tbody></table></div></>}
   {['prepared','ready'].includes(record.state)&&<><label className="block text-sm">Evaluation decision reason<textarea className={auditField} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="flex flex-wrap gap-2">{record.state==='prepared'&&<button className={auditButton} disabled={!enabled||record.actor_id!==actor} onClick={()=>void work(resume)}>Resume saved evaluation</button>}<button className={auditButton} disabled={!enabled||record.state!=='ready'||!reason.trim()} onClick={()=>void work(()=>decide('apply'))}>Apply reviewed scores</button><button className={auditButton} disabled={!enabled||!reason.trim()} onClick={()=>void work(()=>decide('discard'))}>Discard evaluation</button></div></>}
   <details><summary className="text-sm">Original evidence and calculation</summary><div className="mt-2 max-h-96 overflow-auto text-xs"><AuditEvidence value={{evaluatorVersion:record.evaluator_version,originalEvidence:record.source,calculation:record.preview}}/></div></details>
  </div>}
 </section>
}
