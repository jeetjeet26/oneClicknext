
'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {crmResponse,savedCRMRequest} from '@/utils/crm/client'
type Field={name:string;label:string;type:string;required:boolean}
type CheckResult={status:'checked'|'limited'|'failed';messageCode:string;connection?:{success:boolean;evidenceSource:string};schema?:{objectName:string;evidenceSource:string;fields:Field[]};suggestions?:{source:string;target:string}[];mappingIssues?:{unknownTargets:string[];unmappedRequired:string[]}}
type Operation={id:string;kind:'connection'|'schema';integrationId:string;revision:number;state:string;requestedAt:string;currentConfiguration:boolean;receipt:null|{result:CheckResult;accepted:boolean}}
const button='rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600'
const sourceLabel=(source:string)=>({provider_response:'Provider response',provider_plus_defaults:'Provider fields with documented defaults',fallback:'Documented defaults — provider schema not confirmed',local_structure:'Credential format only — no provider response',unverified:'Evidence not confirmed'}[source]||'Evidence not confirmed')
export function CRMSetupChecks({propertyId,integrationId,revision,disabled,canManage}:{propertyId:string;integrationId:string;revision:number;disabled:boolean;canManage:boolean}){
 const [operations,setOperations]=useState<Operation[]>([]),[error,setError]=useState<string|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false)
 const alive=useRef(true),working=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const reload=useCallback(async()=>{const data=await crmResponse(await fetch(`/api/crm/setup?propertyId=${propertyId}`));if(alive.current){setOperations(data.operations);setReady(true)}},[propertyId])
 useEffect(()=>{void reload().catch(err=>{if(alive.current)setError(err.message)})},[reload,revision])
 const active=operations.some(o=>['queued','running'].includes(o.state))
 async function command(kind:'connection'|'schema'|'stop',operation?:Operation){
  if(working.current||!canManage)return
  working.current=true;setBusy(true);setError(null)
  try{
   const input=kind==='stop'?{action:'stop',propertyId,operationId:operation!.id}:{action:'start',propertyId,integrationId:operation?.integrationId||integrationId,revision:operation?.revision||revision,kind}
   const request=await savedCRMRequest('setup-'+kind,input)
   const body=operation&&kind!=='stop'?{...input,requestId:operation.id}:request.body
   await crmResponse(await fetch('/api/crm/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))
   request.acknowledge();await reload()
  }catch(err){if(alive.current)setError(err instanceof Error?err.message:'The check could not be confirmed.')}
  finally{working.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Connection checks and CRM fields</h2><button className={button} disabled={busy} onClick={()=>{setError(null);void reload().catch(err=>{if(alive.current)setError(err.message)})}}>Reload saved checks</button></div><p className="mt-2 text-sm text-gray-500">These checks read the saved connection. They do not create a lead or enable delivery. Field suggestions need your review in the mapping form.</p>
 {error&&<p role="alert" className="mt-3 rounded-lg border border-amber-300 p-3 text-sm">{error}</p>}
 <div className="mt-4 flex flex-wrap gap-3"><button className={button} disabled={!ready||disabled||busy||active} onClick={()=>void command('connection')}>Check saved connection</button><button className={button} disabled={!ready||disabled||busy||active} onClick={()=>void command('schema')}>Discover CRM fields</button></div>
 {!ready?<p className="mt-3 text-sm">Loading saved checks…</p>:operations.length===0?<p className="mt-3 text-sm text-gray-500">No saved provider checks yet.</p>:<div className="mt-5 space-y-4"><p className="text-xs text-gray-500">Latest 30 saved checks</p>{operations.map(o=><article key={o.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"><h3 className="font-medium">{o.kind==='schema'?'CRM field discovery':'Connection check'} · {o.state==='completed'?'Complete':o.state==='queued'?'Waiting for worker':o.state==='running'?'Awaiting result':o.state==='stopped'?'Stopped':'Check failed'}</h3><p className="mt-1 text-xs text-gray-500">Version {o.revision} · {new Date(o.requestedAt).toLocaleString()}{!o.currentConfiguration?' · Earlier configuration':''}</p>
 {['queued','running'].includes(o.state)&&<><p className="mt-2 text-sm">{o.state==='queued'?'The request is saved. Continue when the worker is available.':'The worker claimed this request. Reload to check its saved result. Stopping prevents this result from being accepted; it cannot undo a read already in progress.'}</p><div className="mt-3 flex flex-wrap gap-3">{o.state==='queued'&&<button className={button} disabled={busy||!canManage||!o.currentConfiguration} onClick={()=>void command(o.kind,o)}>Continue saved check</button>}<button className={button} disabled={busy||!canManage} onClick={()=>void command('stop',o)}>Stop this check</button></div></>}
 {o.receipt&&<div className="mt-3 space-y-2 text-sm">{!o.receipt.accepted&&<p className="text-amber-700">Result retained for history. It was not accepted for the current setup.</p>}<p>{o.receipt.result.connection?sourceLabel(o.receipt.result.connection.evidenceSource):'Provider check could not be confirmed. Review credentials and try a new check.'}</p>{o.receipt.result.status==='limited'&&<p className="text-amber-700">This check has limited evidence. It does not verify delivery or all provider fields.</p>}{o.receipt.result.status==='failed'&&o.receipt.result.connection&&<p className="text-amber-700">The provider did not confirm the connection.</p>}
 {o.receipt.result.schema&&<details><summary className="cursor-pointer">Review {o.receipt.result.schema.fields.length} fields · {sourceLabel(o.receipt.result.schema.evidenceSource)}</summary><div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2 pr-3">CRM field</th><th className="py-2">Requirement</th></tr></thead><tbody>{o.receipt.result.schema.fields.map(f=><tr key={f.name} className="border-t"><td className="break-all py-2 pr-3">{f.name}</td><td className="py-2">{f.required?'Required':'Optional'} · {f.type}</td></tr>)}</tbody></table></div></details>}
 {o.receipt.result.suggestions&&<details><summary className="cursor-pointer">Suggested mappings from known field names</summary><ul className="mt-2 space-y-1">{o.receipt.result.suggestions.map(s=><li className="break-all" key={s.source}>{s.source} → {s.target}</li>)}</ul></details>}
 {o.receipt.result.mappingIssues&&<div><p>Unrecognized destinations: {o.receipt.result.mappingIssues.unknownTargets.join(', ')||'None in this schema'}.</p><p>Required fields without a mapping: {o.receipt.result.mappingIssues.unmappedRequired.join(', ')||'None in this schema'}.</p></div>}
 </div>}</article>)}</div>}
 </section>
}
