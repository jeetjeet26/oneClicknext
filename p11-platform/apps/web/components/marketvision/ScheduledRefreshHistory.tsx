'use client'
import {useEffect,useState} from 'react'
import type {RefreshStatus} from '@/utils/marketvision/refresh-status'
import {marketDate} from './MarketEvidence'
export function ScheduledRefreshHistory({propertyId}:{propertyId:string}){
 const [data,setData]=useState<RefreshStatus|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{const c=new AbortController();void fetch(`/api/marketvision/refresh-status?${new URLSearchParams({propertyId})}`,{cache:'no-store',signal:c.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'Refresh history could not be loaded.');return body}).then(body=>{if(!c.signal.aborted){setData(body);setError('')}}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Refresh history could not be loaded.')});return()=>c.abort()},[propertyId,reload])
 return <section aria-label="Scheduled price refreshes" className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">Scheduled price refreshes</h3><button className="text-sm text-indigo-700" onClick={()=>{setData(null);setError('');setReload(n=>n+1)}}>Reload refresh history</button></div>
 {error?<p role="alert" className="text-red-700">{error}</p>:!data?<p role="status">Loading refresh history…</p>:<>
 <p className="text-sm">{data.paused?'Outbound refreshes are paused.':data.enabled&&data.cadence!=='manual'?`This property is configured for ${data.cadence} refreshes through the existing pricing worker.`:'Scheduled price refreshes are disabled for this property.'} The saved attempts below show what was recorded; configuration alone does not confirm a working schedule.</p>
 <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Last confirmed complete refresh</dt><dd>{data.lastCompletedAt?marketDate(data.lastCompletedAt):'None recorded'}</dd></div><div><dt className="text-slate-500">Latest saved competitor observation</dt><dd>{data.latestObservationAt?marketDate(data.latestObservationAt):'None recorded'}</dd></div></dl>
 <p className="text-xs text-slate-500">A worker can save some observations before failing or outlasting the caller. A newer observation does not prove that every competitor was refreshed.</p>
 {data.attempts.length?<ul className="divide-y">{data.attempts.map(a=><li key={a.id} className="py-3 text-sm"><p className="font-medium">{a.result==='complete'?'Complete':a.result==='partial'?'Partially completed':a.result==='failed'?'Failed':'Completion unconfirmed'} · {marketDate(a.startedAt)}</p><p className="text-slate-500">{a.updated} competitor updates confirmed in the response.{a.result==='unconfirmed'?' The caller did not receive a complete result; the worker may have continued.':''}</p></li>)}</ul>:<p className="text-sm text-slate-500">No property-specific scheduled attempt receipts were found.</p>}
 </>}
 </section>
}
