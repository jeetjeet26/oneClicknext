'use client'
import {useEffect,useRef,useState} from 'react'
import {leadResponse,savedLeadRequest} from '@/utils/leadpulse/client'
const labels:Record<string,string>={useful:'Useful priority',too_high:'Priority too high',too_low:'Priority too low',insufficient_evidence:'Insufficient evidence'}
type Review={id:string;score_id:string;judgment:string;reason:string;created_at:string}
export function LeadScoreReview({propertyId,leadId,scoreId}:{propertyId:string;leadId:string;scoreId:string}){
 const alive=useRef(true),[reviews,setReviews]=useState<Review[]>([]),[revision,setRevision]=useState(0)
 const [judgment,setJudgment]=useState('useful'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{const controller=new AbortController();void fetch(`/api/leadpulse/reviews?leadId=${leadId}`,{signal:controller.signal}).then(leadResponse).then(data=>{if(!controller.signal.aborted)setReviews(data.reviews)}).catch(err=>{if(!controller.signal.aborted)setError(err.message)});return()=>controller.abort()},[leadId,revision])
 async function save(){
  if(busy)return;setBusy(true);setError(null);setSaved(false)
  try{
   const request=await savedLeadRequest('review',{propertyId,leadId,scoreId,judgment,reason:reason.trim()})
   const data=await leadResponse(await fetch('/api/leadpulse/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)}))
   if(!['applied','replayed'].includes(data.state))throw new Error('Review was not confirmed.')
   request.acknowledge();if(alive.current){setReason('');setSaved(true);setRevision(value=>value+1)}
  }catch(err){if(alive.current)setError(err instanceof Error?err.message:'Review could not be saved.')}
  finally{if(alive.current)setBusy(false)}
 }
 return <section className="my-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700" aria-label="Score assessment"><h3 className="font-semibold">Review this priority</h3><p className="mt-1 text-xs text-gray-500">Your assessment is saved against this exact score. It does not change its rules or count as a verified conversion.</p>{error&&<p role="alert" className="mt-2 text-sm text-amber-700">{error}</p>}{saved&&<p role="status" className="mt-2 text-sm">Assessment saved.</p>}<form className="mt-3 space-y-2" onSubmit={e=>{e.preventDefault();void save()}}><label className="block text-sm">Assessment<select value={judgment} disabled={busy} onChange={e=>setJudgment(e.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2">{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">Assessment reason<textarea required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label><button disabled={busy||reason.trim().length<3} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Save assessment</button></form>{reviews.length>0&&<details className="mt-3 text-sm"><summary>Recent saved assessments (up to 20)</summary><ul className="mt-2 space-y-2">{reviews.map(review=><li key={review.id}><p className="font-medium">{labels[review.judgment]} · {review.score_id===scoreId?'This score':'Earlier score'}</p><p>{review.reason}</p><p className="text-xs text-gray-500">{new Date(review.created_at).toLocaleString()}</p></li>)}</ul></details>}</section>
}
