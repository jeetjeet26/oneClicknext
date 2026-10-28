'use client'

import { useCallback,useEffect,useRef,useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PackageProgress } from './PackageProgress'
import { PackageDelivery } from './PackageDelivery'
import { Download,Loader2,Sparkles } from 'lucide-react'
import type { PackageSourceSummary,PackageSummary } from '@/utils/siteforge/packages/contracts'

type View={jobs:PackageSummary[];source:PackageSourceSummary;configured:boolean}
const labels:Record<PackageSummary['state'],string>={queued:'Waiting to begin',preparing:'Gathering property information',starting:'Starting Astra',generating:'Designing, building and reviewing your website',packaging:'Reviewing design and checking the website',ready:'Website package ready',failed:'Build needs attention',uncertain:'Build status needs confirmation'}
const active=(job:PackageSummary)=>!['ready','failed'].includes(job.state)
export function SiteForgePackages({propertyId,packageId}:{propertyId:string;packageId?:string}) {
  const router=useRouter()
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [target,setTarget]=useState<'wordpress'|'standalone'>('wordpress'),[notes,setNotes]=useState('')
  const request=useRef<{key:string;id:string}|null>(null)
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(`/api/siteforge/packages?propertyId=${propertyId}${packageId?`&packageId=${packageId}`:''}`,{cache:'no-store',signal})
    const data=await response.json()
    if(!response.ok) throw new Error(data.error||'Website builds could not be loaded.')
    setView(data);return data as View
  },[propertyId,packageId])
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(`/api/siteforge/packages?propertyId=${propertyId}${packageId?`&packageId=${packageId}`:''}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);return data as View})
      .then(data=>{if(!controller.signal.aborted)setView(data)})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    return ()=>controller.abort()
  },[propertyId,packageId])
  const selected=view?.jobs.find(job=>job.id===packageId)
  const parent=selected?.state==='ready'?selected:null
  const versionUrl=(id:string)=>`/dashboard/siteforge/versions/${propertyId}/${id}`
  const versionName=(job:PackageSummary)=>`${job.target==='wordpress'?'WordPress':'Standalone'} · ${new Date(job.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})} · ${job.id.slice(0,6)}`
  const running=view?.jobs.find(active)
  const runningId=running?.id, runningState=running?.state
  useEffect(()=>{
    if(!runningId || runningState==='uncertain') return
    let cancelled=false,timer:ReturnType<typeof setTimeout>
    const poll=async()=>{
      try {
        const response=await fetch('/api/siteforge/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh',propertyId,id:runningId})})
        if(!response.ok)throw new Error('Progress is unavailable.')
        if(!cancelled) {await load();setError('')}
      } catch {if(!cancelled)setError('Progress could not be refreshed. Your build is saved; use Refresh to check again.')}
      if(!cancelled)timer=setTimeout(poll,10000)
    }
    timer=setTimeout(poll,10000)
    return ()=>{cancelled=true;clearTimeout(timer)}
  },[runningId,runningState,propertyId,load])
  async function generate(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    const body={propertyId,target:parent?.target??target,instructions:notes.trim(),parentId:parent?.id??null}
    const key=JSON.stringify(body)
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
    try {
      const response=await fetch('/api/siteforge/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',requestId:request.current!.id,...body})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error)
      await load();request.current=null;setNotes('');router.push(versionUrl(data.id))
    }catch(e){setError(e instanceof Error?e.message:'This request could not be confirmed. Retry to check the same saved request.')}
    finally{setBusy(false)}
  }
  return <section className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 sm:p-8" aria-labelledby="website-build-title">
    {packageId?<Link href="/dashboard/siteforge" className="mb-5 inline-block text-sm text-indigo-700 hover:underline">← All website versions</Link>:null}
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="website-build-title" className="text-xl font-semibold text-gray-900">{packageId?'Review and edit your website':'Your property websites'}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">{packageId?'Review this version, request changes, then preview the new version before approving it for publication.':'Open a version to preview your website, give feedback and create edits. Each new version keeps its original available for review.'}</p></div>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={busy} onClick={()=>{setError('');void load().catch(e=>setError(e.message))}}>Refresh</button>
    </div>
    {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {!view && !error ? <p role="status" className="mt-6 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Loading saved information…</p> : null}
    {view ? <>
      {packageId&&!selected?<p role="alert" className="mt-6">This version is unavailable for this property. Return to all website versions to choose another.</p>:null}
      {selected?<div className="mt-6 space-y-4">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5"><p className="text-sm text-indigo-700">{view.source.name}</p><h3 className="mt-1 text-lg font-semibold">{versionName(selected)}</h3><p role="status" className="mt-2 text-sm">{labels[selected.state]}</p><PackageProgress state={selected.state}/></div>
        {selected.parent_id?<p className="text-sm text-gray-600">Revision of <Link href={versionUrl(selected.parent_id)} className="underline">an earlier version</Link>.</p>:null}
        {selected.error_message?<p role="alert" className="text-sm text-red-800">{selected.error_message}</p>:null}
        {selected.source_hash!==view.source.hash?<p className="text-sm text-amber-800">Saved property information has changed. Your next revision will include the current information.</p>:null}
        {selected.state==='ready'?<div className="flex flex-wrap gap-4 text-sm"><a href="#package-notes" className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white">Request changes</a><a href={`/api/siteforge/packages?propertyId=${propertyId}&downloadId=${selected.id}`} download className="inline-flex items-center gap-2 rounded-lg border px-4 py-2"><Download className="h-4 w-4"/>Download package</a></div>:null}
        {selected.state==='ready'&&selected.target==='wordpress'?<PackageDelivery propertyId={propertyId} jobId={selected.id}/>:null}
        <details className="rounded-lg border p-4 text-sm"><summary className="cursor-pointer font-medium">Request used for this version</summary><p className="mt-3 whitespace-pre-wrap text-gray-600">{selected.instructions}</p></details>
        {view.jobs.some(job=>job.parent_id===selected.id)?<div className="rounded-lg border p-4 text-sm"><p className="font-medium">Edits created from this version</p><ul className="mt-2 space-y-2">{view.jobs.filter(job=>job.parent_id===selected.id).map(job=><li key={job.id}><Link href={versionUrl(job.id)} className="text-indigo-700 underline">{versionName(job)}</Link><span className="ml-2">{labels[job.state]}</span></li>)}</ul></div>:null}
      </div>:null}
      {!packageId?<div className="mt-8 border-t pt-6"><h3 className="font-semibold text-gray-900">Website versions</h3><p className="mt-1 text-sm text-gray-600">Open a version to review staging, request edits or manage publication.</p>
        {!view.jobs.length?<p className="mt-5 text-sm text-gray-500">Your first website will appear here.</p>:<ul className="mt-5 grid gap-5 md:grid-cols-2">{view.jobs.map((job,index)=><li key={job.id} className="flex flex-col rounded-xl border border-gray-200 p-5 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-3"><h4 className="font-semibold">{job.parent_id?'Website revision':'Website version'}</h4>{index===0?<span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">Latest request</span>:null}</div>
          <p className="mt-2 text-xs text-gray-500">{versionName(job)}</p><p role={active(job)?'status':undefined} className={`mt-3 self-start rounded-full px-3 py-1 text-xs ${job.state==='ready'?'bg-green-50 text-green-800':job.state==='failed'?'bg-red-50 text-red-800':'bg-indigo-50 text-indigo-700'}`}>{labels[job.state]}</p>
          <PackageProgress state={job.state}/><p className="mt-4 line-clamp-3 text-sm leading-6 text-gray-600">{job.instructions}</p>
          {job.error_message?<p className="mt-2 text-sm text-red-800">{job.error_message}</p>:null}
          <Link href={versionUrl(job.id)} className="mt-5 inline-flex self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">{job.state==='ready'?'Open website & edit':'View build'}</Link>
        </li>)}</ul>}
      </div>:null}
      {!packageId||parent?<>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ['Property',view.source.name],['Brand',view.source.brand?'Approved brand':'Direction to be proposed'],['Floorplans',String(view.source.floorplans)],['Approved media',String(view.source.assets)],
      ].map(([label,value])=><div key={label} className="rounded-xl bg-stone-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-sm font-medium text-gray-900">{value}</p></div>)}</div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link href="/dashboard/community?section=facts" className="underline">Review community facts</Link><Link href="/dashboard/siteforge/direction" className="underline">Review website design direction</Link></div>
      {view.source.direction ? <p className="mt-3 text-sm text-gray-600">Design direction: {view.source.directionName??'Approved direction'} · {view.source.directionSource==='website'?'Approved website direction':'Reusable property design brief'}. This is the direction used for the next build.</p> : null}
      {view.source.warnings.length ? <details className="mt-4 rounded-lg border border-amber-200 p-3 text-sm text-amber-900"><summary className="cursor-pointer font-medium">Information to review ({view.source.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{view.source.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details> : null}
      {running?<p role="status" className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">A website build is in progress. <Link href={versionUrl(running.id)} className="underline">View its progress</Link> before requesting another version.</p>:null}
      <form onSubmit={generate} className="mt-6 space-y-4 rounded-xl border border-gray-200 p-5">
        <h3 className="text-lg font-semibold">{parent?'Request changes to this version':'Create a new website'}</h3>
        {parent?<p className="text-sm leading-6 text-gray-600">Astra starts with this version’s saved website files and applies your feedback while preserving the rest of its design. This creates a separate version with current property information. Direct changes made in WordPress are not imported. Staging and the live site stay unchanged until you choose to install or deploy the new version.</p>:null}
        {!parent?<div><label htmlFor="package-target" className="block text-sm font-medium text-gray-800">Website format</label><select id="package-target" value={target} disabled={busy||Boolean(running)} onChange={e=>setTarget(e.target.value as 'wordpress'|'standalone')} className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 sm:max-w-sm"><option value="wordpress">WordPress — editable by your team</option><option value="standalone">Standalone website — ready to upload</option></select></div>:null}
        <div><label htmlFor="package-notes" className="block text-sm font-medium text-gray-800">{parent?'What should change?':'What would you like to create?'}</label><textarea id="package-notes" value={notes} onChange={e=>setNotes(e.target.value)} required maxLength={8000} rows={4} disabled={busy||Boolean(running)} placeholder={parent?"Tell Astra which page to change, what to change, and what to keep. For example: On Community, shorten the introduction and add a neighborhood section. Keep the colors, fonts and other pages unchanged.":"Describe the style, pages and priorities. Saved property information is included automatically."} className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"/></div>
        <div className="flex flex-wrap items-center gap-4"><button type="submit" disabled={busy||Boolean(running)||!view.configured||!notes.trim()} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Sparkles className="h-4 w-4"/>}{parent?'Generate new version':'Generate website'}</button><p className="text-xs text-gray-500">Builds may take several minutes. You can leave this page and return.</p></div>
        {!view.configured?<p className="text-sm text-amber-800">Astra needs to be connected on this server before you can generate a website.</p>:null}
      </form>
      </>:null}

    </>:null}
  </section>
}
