"use client"
import { useEffect,useState } from 'react';

type Status = {
  requests:Array<{request_id:string;operation:string;state:string;created_at:string}>
  confirmations:Array<{booking_id:string;state:string;calendar_confirmed:boolean;email_confirmed:boolean}>
  audits:Array<{run_id:string;surface:string;state:string;coverage:{successful_executions?:number;expected_executions?:number}}>
  analysis?:Array<{batch_id:string;state:string;attempts:number}>
  maintenance:Array<{kind:string;last_success_at:string|null;failures:number;next_attempt_at:string}>
  reservedTokens:number
}
async function fetchStatus(url:string,signal:AbortSignal):Promise<{status:Status;deliveryPaused:boolean}> {
  const response=await fetch(url,{cache:'no-store',signal})
  if(!response.ok) throw new Error('Status could not be loaded')
  return response.json()
}
export function ReliabilityPanel({propertyId,area}:{propertyId:string;area:'luma'|'geo'}) {
  const [data,setData]=useState<{status:Status;deliveryPaused:boolean}|null>(null)
  const [error,setError]=useState(false)
  const [isLoading,setLoading]=useState(true)
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    let active=true
    let busy=false
    const load=async()=>{
      if(busy) return
      busy=true
      try {
        const result=await fetchStatus(`/api/operations/reliability?propertyId=${encodeURIComponent(propertyId)}`,controller.signal)
        if(active) {setData(result);setError(false)}
      } catch {if(active) setError(true)}
      finally {busy=false;if(active)setLoading(false)}
    }
    void load()
    const interval=setInterval(()=>void load(),30000)
    return ()=>{active=false;controller.abort();clearInterval(interval)}
  },[propertyId,revision])

  const status=data?.status
  const needsAttention=area==='luma' ? (status?.requests.filter(r=>r.state==='review').length ?? 0)+(status?.confirmations.filter(r=>r.state==='review').length ?? 0)
    : (status?.audits.filter(r=>['partial','failed'].includes(r.state)).length ?? 0)+(status?.maintenance.filter(r=>r.failures>0).length ?? 0)+(status?.analysis?.filter(r=>r.state==='failed').length ?? 0)
  return <section aria-label="Operational status" className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-900 dark:text-white">Operational status</h2>
      <button type="button" onClick={()=>setRevision(value=>value+1)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">Refresh status</button></div>
    {isLoading ? <p className="mt-3 text-sm text-slate-500" role="status">Loading status…</p> : error ?
      <p className="mt-3 text-sm text-amber-700" role="alert">Status is unavailable. Try refreshing.</p> : status ? <>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{needsAttention ? `${needsAttention} recent items need attention.` : 'No recent items need attention.'}
        {area==='luma' && data?.deliveryPaused ? ' External confirmations and follow-ups are paused.' : ''}</p>
      {area==='luma' ? <div className="mt-3 space-y-2 text-sm">
        <p>{status.confirmations.filter(r=>['queued','running'].includes(r.state)).length} recent tour confirmations pending.</p>
        <p className="text-slate-500">AI allowance reserved today: {status.reservedTokens.toLocaleString()} token units. This is a conservative usage allowance, not a provider bill.</p>
        {status.requests.filter(r=>r.state==='review').map(r=><p key={r.request_id} className="text-amber-700">{r.operation==='chat'?'Conversation':r.operation==='lead'?'Contact capture':'Tour request'} needs a status check before repeating it. Reference {r.request_id.slice(0,8)}.</p>)}
        {status.confirmations.filter(r=>r.state==='review').map(r=><p key={r.booking_id} className="text-amber-700">Tour {r.booking_id.slice(0,8)} needs confirmation review. Calendar {r.calendar_confirmed?'accepted':'unconfirmed'}; email {r.email_confirmed?'accepted':'unconfirmed'}.</p>)}
      </div> : <div className="mt-3 space-y-2 text-sm">
        {status.audits.filter(r=>r.state!=='completed').map(r=><p key={r.run_id}>{r.surface}: {r.state==='partial'?'Incomplete measurement':r.state==='failed'?'Needs review':r.state==='running'?'In progress':'Queued'} — {r.coverage.successful_executions ?? 0} of {r.coverage.expected_executions ?? 0} answers saved.</p>)}
        {status.analysis?.filter(r=>r.state!=='completed').map(r=><p key={r.batch_id}>Recommendations: {r.state==='failed'?'Needs review after bounded retries':r.state==='running'?'Preparing evidence-linked recommendations':'Waiting for the completed measurement and website crawl'}.</p>)}
        {status.maintenance.map((m,i)=><p key={`${m.kind}-${i}`}>{m.kind==='knowledge'?'Website knowledge':'Competitor pricing'}: {m.failures ? 'Refresh failed; retry scheduled.' : m.last_success_at ? `Last confirmed ${new Date(m.last_success_at).toLocaleString()}.` : 'Awaiting a confirmed refresh.'}</p>)}
        {!status.audits.length && !status.maintenance.length ? <p className="text-slate-500">No runs have entered the new recovery queues yet.</p> : null}
      </div>}
      <p className="mt-3 text-xs text-slate-500">Shows up to 20 recent items per category for this property.</p>
    </> : null}
  </section>
}
