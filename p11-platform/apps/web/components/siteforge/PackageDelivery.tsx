'use client'
import {useEffect,useRef,useState} from 'react'
type Target={id:string;websiteId:string;type:string;url:string}
type Release={id:string;jobId:string;kind:'preview'|'approve'|'deploy';state:string;targetId:string;url:string;previewId:string|null;createdAt:string;message?:string;qualityVerified?:boolean}
type View={targets:Target[];releases:Release[]}
export function PackageDelivery({propertyId,jobId}:{propertyId:string;jobId:string}){
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[target,setTarget]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const request=useRef<{key:string;id:string}|null>(null)
 useEffect(()=>{const c=new AbortController();let timer:ReturnType<typeof setTimeout>;async function load(){try{const r=await fetch(`/api/siteforge/packages/delivery?propertyId=${propertyId}`,{signal:c.signal,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);setView(d);if(d.releases.some((x:Release)=>x.jobId===jobId&&x.state==='running'))timer=setTimeout(load,5000)}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Delivery status unavailable.')}}void load();return()=>{c.abort();clearTimeout(timer)}},[propertyId,jobId,refresh])
 const history=view?.releases.filter(r=>r.jobId===jobId)??[],preview=history.find(r=>r.kind==='preview'&&r.state==='succeeded'&&r.qualityVerified),approval=history.find(r=>r.kind==='approve'&&r.state==='succeeded'&&r.previewId===preview?.id),deployed=history.find(r=>r.kind==='deploy'&&r.state==='succeeded'),unresolved=history.some(r=>r.state==='running'||r.state==='uncertain')
 const legacyPreview=history.some(r=>r.kind==='preview'&&r.state==='succeeded'&&!r.qualityVerified)&&!preview
 const staging=view?.targets.filter(t=>t.type==='staging')??[],previewTarget=view?.targets.find(t=>t.id===preview?.targetId),production=view?.targets.filter(t=>t.type==='production'&&t.websiteId===previewTarget?.websiteId&&t.url!==previewTarget?.url)??[]
 async function act(kind:'preview'|'approve'|'deploy'){
  if(!confirmed)return;const targetId=kind==='approve'?preview?.targetId:target;const body={kind,propertyId,jobId,targetId,confirmed:true,...(kind!=='preview'?{previewId:preview?.id}:{}),...(kind==='deploy'?{approvalId:approval?.id}:{})};const key=JSON.stringify(body);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};setBusy(true);setError('');try{const r=await fetch('/api/siteforge/packages/delivery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:request.current.id})});const d=await r.json();if(!r.ok)throw Error(d.error);request.current=null;setConfirmed(false);setTarget('');setRefresh(n=>n+1)}catch(e){setError(e instanceof Error?e.message:'Delivery was not confirmed.')}finally{setBusy(false)}
 }
 async function inspect(){const r=history.find(x=>x.state==='running'||x.state==='uncertain');if(!r)return;setBusy(true);setError('');try{const response=await fetch('/api/siteforge/packages/delivery',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,releaseId:r.id})});const body=await response.json();if(!response.ok)throw Error(body.error);setRefresh(n=>n+1)}catch(e){setError(e instanceof Error?e.message:'Inspection unavailable.')}finally{setBusy(false)}}
 const kind=!preview?'preview':!approval?'approve':'deploy',options=kind==='preview'?staging:production
 return <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
  <p className="font-medium">Preview → Approve → Deploy to Cloudways</p>
  <p className="mt-1 text-gray-600">Preview uses a connected staging WordPress site. Deployment pushes the reviewed staging site to its linked production site. The preview installs the complete pages and checks content, navigation, images and floorplans before design approval.</p>
  {error?<p role="alert" className="mt-3 text-red-800">{error}</p>:null}
  {!view&&!error?<p className="mt-3">Loading delivery options…</p>:null}
  {preview?<p className="mt-3 font-medium text-green-900">Website checks passed · {approval?'Version approved':'Awaiting your design approval'}</p>:null}
  {preview?<a className="mt-3 inline-block underline" href={preview.url} target="_blank" rel="noopener noreferrer">Open WordPress preview</a>:null}
  {deployed?<p className="mt-3">Deployed: <a href={deployed.url} target="_blank" rel="noopener noreferrer" className="underline">Open website</a></p>:null}
  {legacyPreview?<p className="mt-3 text-amber-900">This earlier version passed only theme installation. Generate a new version to use complete page installation and website checks.</p>:null}
  {!legacyPreview&&history[0]?.message?<p className="mt-3 text-gray-600">{history[0].message}</p>:null}
  {unresolved?<p role="status" className="mt-3">{history.some(r=>r.state==='uncertain')?'Delivery needs inspection before another attempt.':'Preparing WordPress. This may take several minutes.'}</p>:null}
  {unresolved?<button type="button" disabled={busy} className="mt-3 underline" onClick={()=>void inspect()}>Check WordPress without redeploying</button>:null}
  {view&&!unresolved&&!deployed&&!legacyPreview?<>
   {kind!=='approve'?<label className="mt-3 block">{kind==='preview'?'Preview destination':'Production destination'}<select value={target} onChange={e=>{setTarget(e.target.value);setConfirmed(false)}} className="mt-1 block w-full rounded-lg border bg-white p-2" disabled={busy}><option value="">Select a connected WordPress site</option>{options.map(t=><option key={t.id} value={t.id}>{t.url}</option>)}</select></label>:null}
   {kind!=='approve'&&!options.length?<p className="mt-3 text-amber-900">No connected {kind==='preview'?'staging':'production'} destination is available for this property. Connect the Cloudways WordPress destination before continuing. Your package is still available to download.</p>:<><label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>{kind==='preview'?'Install this package on the selected staging site for review. This installs its theme and complete pages, and keeps conflicting earlier staging pages as drafts.':kind==='approve'?'I reviewed this WordPress preview, its pages, content and editing workflow, and approve this exact package.':'Replace the selected production site’s files and database with the reviewed staging site. Cloudways will take a backup first.'}</span></label><button type="button" disabled={busy||!confirmed||(kind!=='approve'&&!target)} onClick={()=>void act(kind)} className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50">{busy?'Saving…':kind==='preview'?'Create WordPress preview':kind==='approve'?'Approve this version':'Deploy to Cloudways'}</button></>}
  </>:null}
  <button type="button" onClick={()=>{setError('');setRefresh(n=>n+1)}} className="mt-3 block underline" disabled={busy}>Refresh delivery status</button>
 </div>
}
