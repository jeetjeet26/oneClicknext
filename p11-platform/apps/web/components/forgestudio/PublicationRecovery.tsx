'use client'
import {useEffect,useState} from 'react'
import {savedEditorialRequest} from '@/utils/forgestudio/client'
type Evidence={publication:{status:string;updated_at:string;remote_post_id:string|null};job:{lifecycle_status:string;lease_expires_at:string|null;status_reason:string}|null;receipts:Array<{id:string;kind:string;created_at:string;evidence:{reason?:string;providerPostId?:string;accountId?:string;snapshot?:{accountId?:string}}}>}
const labels:Record<string,string>={write_intent:'Provider write authorized once',provider_acknowledged:'Provider acknowledged a post',provider_uncertain:'Provider result is uncertain',blocked_before_send:'Stopped before sending',operator_attestation:'Existing post recorded by a manager'}
export function PublicationRecovery({publicationId,onSaved}:{publicationId:string;onSaved:()=>void}){
 const [data,setData]=useState<Evidence|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[postId,setPostId]=useState(''),[postUrl,setPostUrl]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{const controller=new AbortController();fetch(`/api/forgestudio/publications/${publicationId}`,{signal:controller.signal}).then(async res=>{const value=await res.json();if(!res.ok)throw new Error(value.error||'Could not load saved evidence');return value}).then(value=>{if(!controller.signal.aborted){setData(value);setError('')}}).catch(error=>{if(!controller.signal.aborted){setData(null);setError(error.message)}});return()=>controller.abort()},[publicationId,reload])
 async function save(action:'resume_before_send'|'record_existing_post'){
  if(!data)return
  setBusy(true);setError('')
  try{
   const request=await savedEditorialRequest('publication-recovery-'+publicationId,{action,expectedUpdatedAt:data.publication.updated_at,reason,...(action==='record_existing_post'?{providerPostId:postId.trim(),providerPostUrl:postUrl.trim()}:{})})
   const response=await fetch(`/api/forgestudio/publications/${publicationId}/recovery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)})
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Review could not be saved')
   request.acknowledge();onSaved()
  }catch(error){setError(error instanceof Error?error.message:'Review could not be saved')}finally{setBusy(false)}
 }
 const intent=data?.receipts.find(x=>x.kind==='write_intent')
 const active=data?.job?.lifecycle_status==='running'&&(!data.job.lease_expires_at||Date.parse(data.job.lease_expires_at)>Date.now())
 const closed=data&&['published','cancelled'].includes(data.publication.status)
 return <section aria-label="Publication evidence and recovery" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-slate-900">
  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Publication evidence</h4><button type="button" onClick={()=>setReload(x=>x+1)} disabled={busy} className="text-sm underline">Reload saved evidence</button></div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {!data&&!error&&<p role="status">Loading saved evidence…</p>}
  {data&&<>
   <ul className="space-y-2 text-sm">{data.receipts.map(receipt=><li key={receipt.id}><strong>{labels[receipt.kind]||'Saved publication evidence'}</strong> · {new Date(receipt.created_at).toLocaleString()}{receipt.evidence.reason&&<p>{receipt.evidence.reason}</p>}{receipt.evidence.providerPostId&&<p>Post: {receipt.evidence.providerPostId}</p>}</li>)}</ul>
   {data.receipts.length===0&&<p className="text-sm">No new publication receipt is saved. Older attempts must be reviewed before recovery.</p>}
   {active?<p className="text-sm">A worker still owns this publication. Reload its evidence after the current attempt ends.</p>:!closed&&<>
    <p className="text-sm">{intent?`A write may have reached account ${intent.evidence.snapshot?.accountId||'shown in the saved schedule'}. Check the exact content at that destination. This page cannot resend it.`:'After resolving the problem, a manager can resume only if the saved history proves no provider write was authorized.'}</p>
    <label className="block text-sm">Evidence reviewed<textarea aria-label="Publication recovery evidence" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} className="mt-1 block w-full rounded border p-2"/></label>
    {intent&&<>
     <label className="block text-sm">Existing provider post ID<input value={postId} onChange={e=>setPostId(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
     <label className="block text-sm">Existing post URL<input type="url" value={postUrl} onChange={e=>setPostUrl(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
     <p className="text-sm">Saving records your review of an existing post. It is labelled as a manager’s attestation, not an automatic provider verification.</p>
    </>}
    <button disabled={busy||reason.trim().length<10||Boolean(intent&&(!postId.trim()||!postUrl.startsWith('https://')))} onClick={()=>save(intent?'record_existing_post':'resume_before_send')} className="rounded bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Saving review…':intent?'Record the existing post':'Resume only if no write occurred'}</button>
   </>}
  </>}
 </section>
}
