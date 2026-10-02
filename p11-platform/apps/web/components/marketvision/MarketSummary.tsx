'use client'
import {useMarketAnalysis} from '@/utils/marketvision/use-analysis'
import {marketDate,marketMoney} from './MarketEvidence'
export function MarketSummary({propertyId,onRefresh}:{propertyId:string|undefined;onRefresh?:()=>void}) {
  const {data,error,loading,refresh}=useMarketAnalysis(propertyId,'summary',{days:'7'})
  if(!propertyId)return <p>Select a property to view market data.</p>
  const reload=()=>{refresh();onRefresh?.()}
  return <section aria-label="Market summary" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Saved market overview</h2><button onClick={reload} disabled={loading} className="text-sm text-indigo-700 disabled:opacity-50">Reload overview</button></div>
    {loading?<p role="status">Loading market evidence…</p>:error?<p role="alert" className="rounded border border-red-200 bg-red-50 p-4">{error}</p>:data&&<>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        ['Active competitors',data.summary.competitorCount],['Saved floor plans',data.summary.totalUnitsTracked],['Known starting rents',data.summary.pricedPlans],['Price changes saved in 7 days',data.summary.recentPriceChanges]
      ].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</div>
      <div className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Starting rents by bedroom count</h3><p className="mt-2 text-sm text-slate-600">{data.methodology}</p>
        {Object.keys(data.summary.avgRentByBedroom).length===0?<p className="mt-3">No saved floor-plan prices yet.</p>:<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(data.summary.avgRentByBedroom).map(([bedroom,r])=><div key={bedroom} className="rounded-lg bg-slate-50 p-3"><h4>{bedroom==='0BR'?'Studio':bedroom}</h4><p className="text-xl font-semibold">{marketMoney(r.avg)}</p><p className="text-sm text-slate-600">{r.pricedPlans} of {r.totalPlans} plans priced · {r.competitorsSampled} competitors</p><p className="text-xs text-slate-600">Known lower / upper bounds: {marketMoney(r.min)} / {marketMoney(r.max)}</p></div>)}</div>}
        <p className="mt-4 text-sm text-slate-600">Latest saved pricing: {marketDate(data.summary.lastUpdated)}. Latest verified page fetch: {marketDate(data.summary.lastFetchedAt)}.</p><p className="mt-1 text-sm text-slate-600">Price effective dates are unknown for {data.summary.unknownEffectiveDates} of {data.summary.totalUnitsTracked} plans.</p>
      </div>
    </>}
  </section>
}
