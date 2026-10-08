'use client'

import { useCallback,useEffect,useRef,useState } from 'react'
import Link from 'next/link'
import { PackageDelivery } from './PackageDelivery'
import { Download,Loader2,Sparkles } from 'lucide-react'
import type { PackageSourceSummary,PackageSummary } from '@/utils/siteforge/packages/contracts'

type View={jobs:PackageSummary[];source:PackageSourceSummary;configured:boolean}
const labels:Record<PackageSummary['state'],string>={queued:'Waiting to begin',preparing:'Gathering property information',starting:'Starting Astra',generating:'Designing, building and reviewing your website',packaging:'Reviewing design and checking the website',ready:'Website package ready',failed:'Build needs attention',uncertain:'Build status needs confirmation'}
const active=(job:PackageSummary)=>!['ready','failed'].includes(job.state)
export function SiteForgePackages({propertyId}:{propertyId:string}) {
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [target,setTarget]=useState<'wordpress'|'standalone'>('wordpress'),[notes,setNotes]=useState(''),[parent,setParent]=useState<PackageSummary|null>(null)
  const request=useRef<{key:string;id:string}|null>(null)
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(`/api/siteforge/packages?propertyId=${propertyId}`,{cache:'no-store',signal})
    const data=await response.json()
    if(!response.ok) throw new Error(data.error||'Website builds could not be loaded.')
    setView(data);return data as View
  },[propertyId])
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(`/api/siteforge/packages?propertyId=${propertyId}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);return data as View})
      .then(data=>{if(!controller.signal.aborted)setView(data)})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[propertyId])
  const running=view?.jobs.find(active)
  const runningId=running?.id, runningState=running?.state
  useEffect(()=>{
    if(!runningId || runningState==='uncertain') return
    let cancelled=false,timer:ReturnType<typeof setTimeout>
    const poll=async()=>{
      try {
        const response=await fetch('/api/siteforge/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh',propertyId,id:runningId})})
        if(!response.ok)throw new Error('Progress is unavailable.')
        if(!cancelled) await load()
      } catch {if(!cancelled)setError('Progress could not be refreshed. Your build is saved; use Refresh to check again.')}
      if(!cancelled)timer=setTimeout(poll,10000)
    }
    timer=setTimeout(poll,10000)
    return ()=>{cancelled=true;clearTimeout(timer)}
  },[runningId,runningState,propertyId,load])
  async function generate(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    const body={propertyId,target,instructions:notes.trim(),parentId:parent?.id??null}
    const key=JSON.stringify(body)
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
    try {
      const response=await fetch('/api/siteforge/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',requestId:request.current!.id,...body})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error)
      await load();request.current=null
    }catch(e){setError(e instanceof Error?e.message:'This request could not be confirmed. Retry to check the same saved request.')}
    finally{setBusy(false)}
  }
  return <section className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 sm:p-8" aria-labelledby="website-build-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="website-build-title" className="text-xl font-semibold text-gray-900">Create your property website</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Astra builds your website here, using the information and approved media saved for this property. Review the finished website, approve it, and deploy to a connected Cloudways WordPress site. You can also download the source, assets and setup instructions.</p></div>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={busy} onClick={()=>{setError('');void load().catch(e=>setError(e.message))}}>Refresh</button>
    </div>
    {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {!view && !error ? <p role="status" className="mt-6 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Loading saved information…</p> : null}
    {view ? <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ['Property',view.source.name],['Brand',view.source.brand?'Approved brand':'Direction to be proposed'],['Floorplans',String(view.source.floorplans)],['Approved media',String(view.source.assets)],
      ].map(([label,value])=><div key={label} className="rounded-xl bg-stone-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-sm font-medium text-gray-900">{value}</p></div>)}</div>
      <Link href="/dashboard/intelligence" className="mt-4 inline-block text-sm underline">Review property facts and creative direction</Link>
      {view.source.direction ? <p className="mt-3 text-sm text-gray-600">Your approved creative direction will also be included.</p> : null}
      {view.source.warnings.length ? <details className="mt-4 rounded-lg border border-amber-200 p-3 text-sm text-amber-900"><summary className="cursor-pointer font-medium">Information to review ({view.source.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{view.source.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details> : null}
      <form onSubmit={generate} className="mt-6 space-y-4">
        {parent ? <div className="flex items-center justify-between rounded-lg bg-stone-50 p-3 text-sm"><span>New version of the {new Date(parent.created_at).toLocaleDateString()} website. Current saved information will be included.</span><button type="button" onClick={()=>setParent(null)} className="ml-3 underline">Cancel revision</button></div> : null}
        <div><label htmlFor="package-target" className="block text-sm font-medium text-gray-800">Website format</label><select id="package-target" value={target} disabled={busy||Boolean(running)} onChange={e=>setTarget(e.target.value as 'wordpress'|'standalone')} className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 sm:max-w-sm"><option value="wordpress">WordPress — editable by your team</option><option value="standalone">Standalone website — ready to upload</option></select></div>
        <div><label htmlFor="package-notes" className="block text-sm font-medium text-gray-800">{parent?'What should change?':'What would you like to create?'}</label><textarea id="package-notes" value={notes} onChange={e=>setNotes(e.target.value)} required maxLength={8000} rows={4} disabled={busy||Boolean(running)} placeholder="Describe the style, pages and priorities. Saved property information is included automatically." className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"/></div>
        <div className="flex flex-wrap items-center gap-4"><button type="submit" disabled={busy||Boolean(running)||!view.configured||!notes.trim()} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Sparkles className="h-4 w-4"/>}{parent?'Generate new version':'Generate website'}</button><p className="text-xs text-gray-500">Builds may take several minutes. You can leave this page and return.</p></div>
        {!view.configured?<p className="text-sm text-amber-800">Astra needs to be connected on this server before you can generate a website.</p>:null}
      </form>
      <div className="mt-8 border-t pt-6"><h3 className="font-semibold text-gray-900">Website packages</h3><p className="mt-1 text-sm text-gray-600">Each version retains the information used to build it. Review the website and editing instructions before publishing.</p>
        {!view.jobs.length?<p className="mt-5 text-sm text-gray-500">Your first website package will appear here.</p>:<ul className="mt-4 divide-y">{view.jobs.map(job=><li key={job.id} className="py-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-gray-900">{job.target==='wordpress'?'WordPress':'Standalone'} website · {new Date(job.created_at).toLocaleDateString()}</p><p role={active(job)?'status':undefined} className="mt-1 text-sm text-gray-600">{labels[job.state]}</p></div><div className="flex gap-3">{job.state==='ready'?<><a href={`/api/siteforge/packages?propertyId=${propertyId}&downloadId=${job.id}`} download className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Download className="h-4 w-4"/>Download package</a><button type="button" disabled={busy||Boolean(running)} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>{setParent(job);setTarget(job.target);setNotes('');document.getElementById('package-notes')?.focus()}}>Create revision</button></>:null}</div></div><p className="mt-2 line-clamp-2 text-sm text-gray-500">{job.instructions}</p>{job.source_hash!==view.source.hash?<p className="mt-2 text-xs text-amber-800">Property information has changed since this version was requested.</p>:null}{job.state==='ready'&&job.target==='wordpress'?<PackageDelivery propertyId={propertyId} jobId={job.id}/>:null}{job.error_message?<p className="mt-2 text-sm text-red-800">{job.error_message}</p>:null}</li>)}</ul>}
      </div>
    </>:null}
  </section>
}
