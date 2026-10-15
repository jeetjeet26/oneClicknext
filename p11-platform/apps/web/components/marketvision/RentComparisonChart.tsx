'use client'
import {useState} from 'react'
import {useCompetitorProfiles} from '@/utils/marketvision/use-profiles'
import {rentSummary} from '@/utils/marketvision/profiles'
import {money} from './CompetitorProfileContent'
export function RentComparisonChart({propertyId,ourPropertyName='Your property'}:{propertyId:string|undefined;ourPropertyName?:string;ourRent?:number}) {
  const [bedrooms,setBedrooms]=useState('all')
  const {data,error,loading,refresh}=useCompetitorProfiles(propertyId)
  const active=data?.competitors.filter(c=>c.isActive)??[]
  const choices=[...new Set([...active.flatMap(c=>c.units??[]).map(u=>u.bedrooms),...(data?.subject.units??[]).map(u=>u.bedrooms)])].sort((a,b)=>a-b)
  const filter=bedrooms==='all'?undefined:Number(bedrooms)
  const rows=data?[{id:'subject',name:data.subject.name||ourPropertyName,units:data.subject.units.map(u=>({bedrooms:u.bedrooms,rentMin:u.rent_min})),scope:false},...active.map(c=>({id:c.id,name:c.name,units:(c.units??[]).filter(u=>!c.withheldUnitIds.includes(u.id)),scope:c.scopeNotes.length>0}))]:[]
  if(!propertyId)return <p>Select a property to compare rents.</p>
  return <section aria-label="Rent comparison" className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Your property and the market</h3><button onClick={refresh} disabled={loading} className="text-sm text-indigo-700 disabled:opacity-50">Reload comparison</button></div>
    <label className="mt-3 block text-sm">Bedroom filter <select value={bedrooms} onChange={e=>setBedrooms(e.target.value)} className="ml-2 rounded border p-1"><option value="all">All bedroom counts</option>{choices.map(i=><option key={i} value={i}>{i===0?'Studio':`${i} bedrooms`}</option>)}</select></label>
    {loading?<p role="status" className="mt-4">Loading comparison…</p>:error?<p role="alert" className="mt-4 text-red-700">{error}</p>:data&&<>
      {data.warnings.map(w=><p key={w} className="mt-3 text-sm text-amber-800">{w}</p>)}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th scope="col" className="p-2">Community</th><th scope="col" className="p-2">Mean starting rent</th><th scope="col" className="p-2">Priced plans</th></tr></thead><tbody>{rows.map(c=>{const stats=rentSummary(c.units,filter);return <tr key={c.id} className={`border-t ${c.id==='subject'?'bg-emerald-50':''}`}><th scope="row" className="p-2 text-left font-medium">{c.name}{c.id==='subject'&&<span className="block text-xs">Your property · approved prices</span>}</th><td className="p-2">{c.scope?'Scope needs review':money(stats.mean)}</td><td className="p-2">{c.scope?'Withheld':`${stats.priced} / ${stats.total}`}</td></tr>})}</tbody></table></div>
      <p className="mt-3 text-xs text-slate-500">Mean advertised starting rent per saved plan. Each plan counts once; missing and conflicting prices stay unknown. Bedroom mix, observation dates, amenities and lease terms can differ. Filter by bedroom count for a closer comparison.</p>
    </>}
  </section>
}
