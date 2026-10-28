'use client'
import {useCallback,useEffect,useState} from 'react'
import {HistoryNote} from '@/components/ui/decision-note'
import {ACTION_LABELS} from '@/utils/actions/catalog'
interface Entry{id:string;kind:string;reason:string;createdAt:string;before:Record<string,unknown>|null;after:Record<string,unknown>|null;retainedPriceObservations:number}
export function MarketDecisionHistory({propertyId,resourceId}:{propertyId:string;resourceId?:string}){
 const [rows,setRows]=useState<Entry[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const load=useCallback(async(after?:string)=>{setBusy(true);setError('');try{const p=new URLSearchParams({propertyId,...(resourceId?{resourceId}:{}),...(after?{cursor:after}:{})}),r=await fetch(`/api/marketvision/history?${p}`),d=await r.json();if(!r.ok)throw new Error(d.error||'History could not be loaded.');setRows(v=>after?[...v,...d.history]:d.history);setCursor(d.nextCursor)}catch(e){setError(e instanceof Error?e.message:'History could not be loaded.')}finally{setBusy(false)}},[propertyId,resourceId])
 useEffect(()=>{void load()},[load])
 return <section aria-label="Market change history" className="space-y-3 border rounded-xl p-4">
  <div className="flex justify-between gap-3"><h3 className="font-semibold">Change history</h3><button disabled={busy} className="text-sm underline" onClick={()=>load()}>Refresh</button></div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {!busy&&!error&&!rows.length&&<p className="text-sm text-gray-500">No changes yet.</p>}
  <ol className="divide-y">{rows.map(row=><li key={row.id} className="py-3 text-sm">
   <p>{ACTION_LABELS[`market.${row.kind}`]||row.kind.replaceAll('_',' ')}</p>
   <time dateTime={row.createdAt} className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</time>
   <HistoryNote value={row.reason}/>
  </li>)}</ol>
  {busy&&<p className="text-sm">Loading change history…</p>}
  {cursor&&<button disabled={busy} onClick={()=>load(cursor)} className="underline text-sm">Load more changes</button>}
 </section>
}
