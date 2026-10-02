'use client'
import {useState} from 'react'
import type {MarketAnalysis} from '@/utils/marketvision/analysis'
export const marketMoney=(v:number|null|undefined)=>v==null?'Unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v)
export const marketDate=(v:string|null|undefined)=>v?new Date(v).toLocaleString():'Unknown'
export function MarketEvidence({evidence}:{evidence:MarketAnalysis['evidence']}) {
  const [page,setPage]=useState(0),current=Math.min(page,Math.max(0,Math.ceil(evidence.length/20)-1))
  return <details className="mt-4 rounded-lg border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-medium">Pricing evidence ({evidence.length} floor plans)</summary>
    <p className="mt-2 text-slate-600">Saved time is when the console recorded the value. A fetched page is separate from the date its prices take effect.</p>
    <ul className="mt-3 space-y-3">{evidence.slice(current*20,(current+1)*20).map((e,i)=><li key={`${e.unitId}:${e.historyId??i}`} className="break-words rounded bg-slate-50 p-3">
      <p className="font-medium">{e.competitorName} · {e.unitType}</p><p>Saved: {marketDate(e.recordedAt)}</p><p>Page fetched: {e.fetchedAt?marketDate(e.fetchedAt):'Not verified'}</p><p>Price effective date: {marketDate(e.effectiveAt)}</p>
      {e.sourceUrl&&/^https?:\/\//i.test(e.sourceUrl)&&<a className="text-indigo-700 underline break-all" href={e.sourceUrl} target="_blank" rel="noopener noreferrer">Source page</a>}
      {e.captureId&&<p className="mt-1 text-xs text-slate-500">Capture reference: {e.captureId}</p>}
      {!e.captureId&&<p className="text-slate-600">No linked source capture.</p>}
    </li>)}</ul>
    {evidence.length>20&&<div className="mt-3 flex flex-wrap items-center gap-3"><button disabled={current===0} onClick={()=>setPage(current-1)} className="disabled:opacity-40">Previous evidence</button><span>Page {current+1} of {Math.ceil(evidence.length/20)}</span><button disabled={(current+1)*20>=evidence.length} onClick={()=>setPage(current+1)} className="disabled:opacity-40">More evidence</button></div>}
  </details>
}
