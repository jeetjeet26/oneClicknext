'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {crmResponse} from '@/utils/crm/client'
type Snapshot={counts:Record<string,number>;confirmedOutcomes:Record<string,number>;legacyLeads:number;observedAt:string}
const labels:Record<string,string>={review:'Awaiting value review',approved:'Approved · Waiting for worker',searching:'Checking destination',sending:'Awaiting provider result',needs_reconciliation:'Uncertain · Review required',failed:'Stopped before sending',cancelled:'Stopped',confirmed:'Confirmed destination or note'}
const outcomes:Record<string,string>={created:'New records confirmed',linked:'Existing records linked',note_added:'Notes confirmed',destination_confirmed:'Destinations confirmed in recovery'}
export function CRMSyncMonitor({propertyId,compact=false,showHistory=true}:{propertyId:string;compact?:boolean;showHistory?:boolean}){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true)
 const controller=useRef<AbortController|null>(null)
 const reload=useCallback(async()=>{controller.current?.abort();const current=new AbortController();controller.current=current;setLoading(true);setError(null)
  try{const saved=await crmResponse(await fetch(`/api/crm/monitor?propertyId=${propertyId}`,{signal:current.signal}));if(!current.signal.aborted)setData(saved)}
  catch(err){if(!current.signal.aborted){setError(err instanceof Error?err.message:'CRM status unavailable.');setData(null)}}
  finally{if(!current.signal.aborted)setLoading(false)}
 },[propertyId])
 useEffect(()=>{setData(null);void reload();return()=>controller.current?.abort()},[reload])
 return <section aria-label="CRM delivery overview" className={`rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${compact?'p-4':'p-5'}`}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Delivery overview</h2><p className="mt-1 text-sm text-gray-500">Saved transfers for this property, counted once per request.</p></div><button disabled={loading} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void reload()}>Reload delivery overview</button></div>
 {error&&<p role="alert" className="mt-3 text-sm text-amber-700">{error}</p>}{loading&&<p role="status" className="mt-3 text-sm">Checking saved CRM results…</p>}
 {data&&<><dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(labels).map(([key,label])=><div key={key} className="rounded-lg border p-3"><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{data.counts[key]||0}</dd></div>)}</dl><ul className="mt-4 space-y-1 text-sm">{Object.entries(outcomes).map(([key,label])=><li key={key}>{label}: {data.confirmedOutcomes[key]||0}</li>)}</ul><p className="mt-3 text-xs text-gray-500">A recovered destination confirms the link. It does not prove that the original write succeeded. These counts do not measure prospect response or a lease.</p>{data.legacyLeads>0&&<p className="mt-3 text-sm text-amber-700">{data.legacyLeads} older lead records have CRM status without saved transfer evidence. They are excluded from confirmed outcomes and will not be replayed automatically.</p>}<p className="mt-3 text-xs text-gray-500">Checked {new Date(data.observedAt).toLocaleString()}</p></>}
 {showHistory&&<Link className="mt-3 block text-sm text-indigo-600" href="/dashboard/settings/crm">Review saved transfers in CRM setup</Link>}
 </section>
}
export default CRMSyncMonitor
