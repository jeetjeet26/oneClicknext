'use client'
import {useEffect, useState} from 'react'

type Schedule = {enabled:boolean;interval_hours:number;revision:number;next_due_at:string;last_state:string|null}
type Source = {id:string;provider:string;status:string;external_folder_name:string|null;last_synced_at:string|null;last_error:string|null;schedule:Schedule|null}

export function CommunitySources({propertyId}:{propertyId:string}) {
  const [sources,setSources]=useState<Source[]>([])
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true),[readError,setReadError]=useState(''),[attempt,setAttempt]=useState(0)
  useEffect(()=>{
    let active=true
    fetch(`/api/community-brain/sources?propertyId=${propertyId}`,{cache:'no-store'})
      .then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);if(active)setSources(v.sources)})
      .catch(()=>{if(active)setReadError('Connected sources could not be loaded.')})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[propertyId,attempt])
  async function sync(sourceId:string){
    setBusy(true);setMessage('Checking the configured folder and retaining changed originals…')
    try{
      const r=await fetch('/api/community-brain/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,sourceId})})
      const v=await r.json();if(!r.ok)throw Error(v.error)
      setMessage(`${v.run.imported_count} new originals, ${v.run.duplicate_count} unchanged. ${v.run.status==='succeeded'?'Processing and review are available below.':'More files remain; continue this source intake.'}`)
    }catch(e){setMessage(e instanceof Error?e.message:'Source intake needs review.')}
    finally{setBusy(false)}
  }
  async function schedule(source:Source,hours:number){
    setBusy(true)
    try{
      const r=await fetch('/api/community-brain/sources',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,sourceId:source.id,enabled:hours>0,hours:hours||24,revision:source.schedule?.revision??0})})
      const v=await r.json();if(!r.ok)throw Error(v.error)
      setSources(previous=>previous.map(s=>s.id===source.id?{...s,schedule:v.schedule}:s))
      setMessage(hours?'Automatic checks enabled. New and changed originals still require review.':'Automatic checks paused.')
    }catch(e){setMessage(e instanceof Error?e.message:'The schedule could not be confirmed.')}
    finally{setBusy(false)}
  }
  return <section className="space-y-3 rounded-xl border p-5">
    <h2 className="font-medium">Connected originals</h2>
    <p className="text-sm text-muted-foreground">Drive and Dropbox use the same private file review process. Google documents are retained as versioned Office exports. Configure a source folder in the asset library; each folder supports up to 1,000 supported files at its top level.</p>
    {loading&&<p role="status">Loading connected folders…</p>}{readError&&<div role="alert"><p>{readError}</p><button className="console-action mt-2" onClick={()=>{setLoading(true);setReadError('');setSources([]);setAttempt(value=>value+1)}}>Try again</button></div>}
    {message&&<p role="status" className="text-sm">{message}</p>}
    {sources.map(s=><div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div><p className="text-sm">{s.external_folder_name??s.provider.replaceAll('_',' ')} · {s.status}</p>
        {s.last_synced_at&&<p className="text-xs text-muted-foreground">Last check: {new Date(s.last_synced_at).toLocaleString()}</p>}
        {s.schedule?.enabled&&<p className="text-xs text-muted-foreground">Next check after {new Date(s.schedule.next_due_at).toLocaleString()}</p>}
        {s.schedule?.last_state==='authorization_or_source_changed'&&<p className="text-xs">Automatic checks stopped because the source or its access changed.</p>}
      </div>
      <label className="text-sm">Automatic checks <select className="ml-2 rounded border bg-background p-2" value={s.schedule?.enabled?s.schedule.interval_hours:0} disabled={busy||s.status==='revoked'||s.status==='paused'} onChange={e=>void schedule(s,Number(e.target.value))}>
        <option value={0}>Paused</option><option value={1}>Hourly</option><option value={6}>Every 6 hours</option><option value={24}>Daily</option><option value={168}>Weekly</option>
      </select></label>
      <button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={busy||s.status==='revoked'||s.status==='paused'} onClick={()=>void sync(s.id)}>Check and import originals</button>
    </div>)}
    {!loading&&!readError&&sources.length===0&&<p className="text-sm">No connected folders for this community.</p>}
    <p className="text-xs text-muted-foreground">Scheduled checks use the access of the team member who enabled them and stop when that access or the source connection changes.</p>
  </section>
}
