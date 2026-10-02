'use client'
import {useState} from 'react'
import {useMarketAnalysis} from '@/utils/marketvision/use-analysis'
import {marketMoney,MarketEvidence} from './MarketEvidence'
export function RentComparisonChart({propertyId,ourPropertyName='Your property',ourRent}:{propertyId:string|undefined;ourPropertyName?:string;ourRent?:number}) {
  const [bedrooms,setBedrooms]=useState('all')
  const {data,error,loading,refresh}=useMarketAnalysis(propertyId,'comparison',bedrooms==='all'?{}:{bedrooms})
  if(!propertyId)return <p>Select a property to compare rents.</p>
  return <section aria-label="Rent comparison" className="min-w-0 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Compare saved starting rents</h3><button onClick={refresh} disabled={loading} className="text-sm text-indigo-700 disabled:opacity-50">Reload comparison</button></div>
    <label className="mt-3 block text-sm">Bedroom filter <select value={bedrooms} onChange={e=>setBedrooms(e.target.value)} className="ml-2 rounded border p-1"><option value="all">All bedroom counts</option>{Array.from({length:21},(_,i)=><option key={i} value={i}>{i===0?'Studio':`${i} bedrooms`}</option>)}</select></label>
    {loading?<p role="status" className="mt-4">Loading comparison…</p>:error?<p role="alert" className="mt-4 text-red-700">{error}</p>:data&&<>
      <p className="mt-3 text-sm text-slate-600">{data.methodology}</p>
      {ourRent!==undefined&&<p className="mt-3">{ourPropertyName}: {marketMoney(ourRent)} (provided reference value).</p>}
      {data.comparisons.length===0?<p className="mt-4">No active competitors saved.</p>:<div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Competitor</th><th className="p-2">Mean starting rent</th><th className="p-2">Priced plans</th></tr></thead><tbody>{data.comparisons.map(c=><tr key={c.competitor.id} className="border-t"><td className="p-2 break-words">{c.competitor.name}</td><td className="p-2">{marketMoney(c.avgRent)}</td><td className="p-2">{c.pricedPlans} / {c.units.length}</td></tr>)}</tbody></table></div>}
      <p className="mt-3 text-xs text-slate-600">Different bedroom mixes, amenities and lease terms can explain differences. These values do not establish a pricing opportunity.</p>
      <MarketEvidence key={`${propertyId}:${bedrooms}:${data.snapshotAt}`} evidence={data.evidence}/>
    </>}
  </section>
}
