'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {savedEditorialRequest} from '@/utils/forgestudio/client'
type Row={id:string;brief_id:string;state:string;package_id:string|null;revision_id:string;error_code:string|null;created_at:string;updated_at:string;claim_expires_at:string;hasSavedResult:boolean;social_content_briefs:{title:string}|null}
const labels:Record<string,string>={preparing:'Preparing saved inputs',ready:'Inputs saved',generating:'Model result pending',result_ready:'Result saved — ready to recover',completed:'Draft saved',failed:'Request stopped before completion',stopped:'Stopped by an operator'}
export function GenerationRequests({propertyId,refreshKey,onGenerated}:{propertyId:string;refreshKey:number;onGenerated:(value:{packageId:string;revisionId:string})=>void}){
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null),[stopId,setStopId]=useState<string|null>(null),[reason,setReason]=useState('')
 const [nextCursor,setNextCursor]=useState<string|null>(null),[loadingMore,setLoadingMore]=useState(false)
 const controller=useRef<AbortController|null>(null)
 const load=useCallback(async(cursor?:string)=>{controller.current?.abort();const current=new AbortController();controller.current=current;if(cursor)setLoadingMore(true);else setLoading(true);setError('');try{const response=await fetch(`/api/forgestudio/generations?${new URLSearchParams({propertyId,...(cursor?{cursor}:{})})}`,{signal:current.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);if(!current.signal.aborted){setRows(previous=>cursor?[...previous,...(data.requests||[]).filter((r:Row)=>!previous.some(p=>p.id===r.id))]:(data.requests||[]));setNextCursor(data.nextCursor??null)}}catch(error){if(!current.signal.aborted){if(!cursor){setRows([]);setNextCursor(null)};setError(error instanceof Error?error.message:'Could not load saved requests')}}finally{if(!current.signal.aborted){setLoading(false);setLoadingMore(false)}}},[propertyId])
 useEffect(()=>{void load();return()=>controller.current?.abort()},[load,refreshKey])
 async function decide(row:Row,action:'recover'|'stop'|'new_attempt'){
  setBusy(row.id);setError('')
  try{
   const request=await savedEditorialRequest('generation-'+action+'-'+row.id,{action,...(action==='stop'?{expectedUpdatedAt:row.updated_at,reason}:{})})
   const url=action==='new_attempt'?`/api/forgestudio/briefs/${row.brief_id}/generate`:`/api/forgestudio/generations/${row.id}`
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)})
   const data=await response.json();if(!response.ok||response.status===202)throw new Error(data.error||'Reload the saved request status')
   request.acknowledge();setStopId(null);setReason('');await load()
   if(data.result?.packageId)onGenerated({packageId:data.result.packageId,revisionId:data.result.revisionId})
  }catch(error){setError(error instanceof Error?error.message:'Saved decision could not be confirmed')}finally{setBusy(null)}
 }
 return <section aria-label="Saved generation requests" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Saved generation requests</h3><button onClick={()=>void load()} disabled={Boolean(busy)||loadingMore} className="text-sm underline">Reload generation requests</button></div>
  <p className="text-sm text-slate-500">Recovering a saved result does not call the model again.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {loading?<p role="status" className="text-sm">Loading saved requests…</p>:!error&&rows.length===0?<p className="text-sm text-slate-500">No saved generation requests yet.</p>:rows.map(row=><div key={row.id} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
   <p className="font-medium">{row.social_content_briefs?.title||'Saved campaign brief'}</p><p className="text-sm">{labels[row.state]||row.state} · {new Date(row.created_at).toLocaleString()}</p>
   {row.error_code==='model_uncertain'&&<p className="text-sm text-amber-700">The model response is uncertain. This request will not silently run again.</p>}
   {['preparing','ready','generating'].includes(row.state)&&Date.parse(row.claim_expires_at)<Date.now()&&<p className="text-sm text-amber-700">The request has exceeded its expected duration. Reload for a late result, or explicitly stop it before requesting a new attempt.</p>}
   {row.state==='stopped'&&row.hasSavedResult&&<p className="text-sm">A result arrived after the stop and remains in the private history. It was not applied to the campaign.</p>}
   <div className="flex flex-wrap gap-3 text-sm">
    {row.state==='completed'&&row.package_id&&<button className="text-violet-700 underline" onClick={()=>onGenerated({packageId:row.package_id!,revisionId:row.revision_id})}>Open saved draft</button>}
    {row.state==='result_ready'&&<button disabled={Boolean(busy)} className="text-violet-700 underline" onClick={()=>void decide(row,'recover')}>{busy===row.id?'Recovering…':'Recover saved result'}</button>}
    {!['completed','stopped'].includes(row.state)&&<button disabled={Boolean(busy)} className="text-amber-700 underline" onClick={()=>{setStopId(row.id);setReason('')}}>Stop this request</button>}
    {['failed','stopped'].includes(row.state)&&<button disabled={Boolean(busy)} className="text-violet-700 underline" onClick={()=>void decide(row,'new_attempt')}>Request a new model run from this brief</button>}
   </div>
   {stopId===row.id&&<div className="space-y-2"><p className="text-sm">Stopping prevents this result from becoming a campaign. A provider request already sent may still finish or incur its charge.</p><label className="block text-sm">Reason for stopping<textarea value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 block w-full rounded border p-2" maxLength={2000}/></label><button onClick={()=>void decide(row,'stop')} disabled={Boolean(busy)||reason.trim().length<10} className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50">Save stop decision</button></div>}
  </div>)}
 {nextCursor&&<button disabled={Boolean(busy)||loadingMore} className="text-sm underline" onClick={()=>void load(nextCursor)}>{loadingMore?'Loading earlier requests…':'Load earlier generation requests'}</button>}
 </section>
}
