'use client'
import {useState} from 'react'
import {LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,ResponsiveContainer} from 'recharts'
import {useMarketAnalysis} from '@/utils/marketvision/use-analysis'
import {marketMoney,MarketEvidence} from './MarketEvidence'
export function PriceTrendChart({propertyId,unitTypeFilter}:{propertyId:string|undefined;unitTypeFilter?:string}) {
  const [days,setDays]=useState('30')
  const {data,error,loading,refresh}=useMarketAnalysis(propertyId,'trends',{days,...(unitTypeFilter&&unitTypeFilter!=='all'?{unitType:unitTypeFilter}:{})})
  if(!propertyId)return <p>Select a property to view price history.</p>
  return <section aria-label="Saved pricing history" className="min-w-0 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Saved pricing history</h3><button onClick={refresh} disabled={loading} className="text-sm text-indigo-700 disabled:opacity-50">Reload price history</button></div>
    <label className="mt-3 block text-sm">History window <select value={days} onChange={e=>setDays(e.target.value)} className="ml-2 rounded border p-1">{[7,30,60,90].map(d=><option key={d} value={d}>Last {d} days</option>)}</select></label>
    {loading?<p role="status" className="mt-4">Loading price history…</p>:error?<p role="alert" className="mt-4 text-red-700">{error}</p>:data&&<>
      <p className="mt-3 text-sm text-slate-600">Same {data.trendCoverage.matchedPlans} of {data.trendCoverage.totalPlans} floor plans across {data.trendCoverage.matchedCompetitors} competitors throughout this window. Plans need a starting record and no unknown rent during the period.</p>
      <p className="mt-2 text-sm">{data.trendCoverage.netChangePct===null?'Movement: insufficient comparable evidence.':`Mean saved starting rent changed ${data.trendCoverage.netChangePct>0?'+':''}${data.trendCoverage.netChangePct}% in this fixed sample.`}</p>
      {data.trends.length===0?<p className="my-5">No complete comparable history for this window.</p>:<div className="mt-4 h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.trends} margin={{top:5,right:10,bottom:5,left:0}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" tickFormatter={v=>new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})} minTickGap={40}/><YAxis width={65} tickFormatter={v=>marketMoney(v)}/><Tooltip labelFormatter={v=>`${new Date(String(v)).toLocaleString('en-US',{timeZone:'UTC'})} UTC`} formatter={v=>[marketMoney(typeof v==='number'?v:null),'Mean saved starting rent']}/><Line dataKey="avgRent" type="stepAfter" stroke="#4f46e5" dot={false} connectNulls={false}/></LineChart></ResponsiveContainer></div>}
      <p className="mt-3 text-xs text-slate-600">Daily checkpoints in UTC, using console recording time. Lines carry the last saved value; they do not confirm current live prices. Newly added, removed or archived plans do not change this sample’s weight.</p>
      <MarketEvidence key={`${propertyId}:${days}:${data.snapshotAt}`} evidence={data.trendCoverage.citations}/>
    </>}
  </section>
}
