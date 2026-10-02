'use client'

import {useCallback,useEffect,useRef,useState} from 'react'

type Kind='sources'|'documents'|'chunks'
type Item={id?:string;key?:string;source_name?:string;source_type?:string;source_url?:string|null;status?:string;file_name?:string|null;documents_created?:number|null;last_synced_at?:string|null;error_message?:string|null;provenance?:Record<string,string>;title?:string;identityBasis?:string;chunkCount?:number;embeddedChunks?:number;lastCreatedAt?:string|null;content?:string;previewTruncated?:boolean;characterCount?:number;chunkIndex?:number|null;hasEmbedding?:boolean}
type Inventory={state:'ready';propertyId:string;inventoryHash:string;kind:Kind;groupKey:string|null;items:Item[];total:number;nextOffset:number|null;summary:{sourceCount:number;chunkCount:number;documentGroups:number;embeddedChunks:number;unitCount:number;sourceStatuses:Record<string,number>};readAt:string}
const provenanceLabels:Record<string,string>={ingestionRunId:'Import reference',brandAssetId:'Brand package',crawlRunId:'Crawl reference',ingestionVersion:'Import version',reportedOrigin:'Reported origin',sourceIdentity:'Source reference',artifactId:'Artifact reference',siteforgeArtifactId:'SiteForge artifact',lastSuccessfulAt:'Reported last success',lastAttemptAt:'Reported last attempt'}
const button='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50'
function externalUrl(value?:string|null){if(!value)return null;try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
function date(value?:string|null){if(!value)return 'Not recorded';const d=new Date(value);return Number.isNaN(d.getTime())?'Not recorded':d.toLocaleString()}
export function KnowledgeInventory({propertyId}:{propertyId:string}) {
 const[view,setView]=useState<{kind:Kind;groupKey?:string}>(()=>{const group=typeof window!=='undefined'?new URL(window.location.href).searchParams.get('knowledgeGroup'):null;return group&&/^[a-f0-9]{64}$/.test(group)?{kind:'chunks',groupKey:group}:{kind:'sources'}})
 const[data,setData]=useState<Inventory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 const generation=useRef(0),controller=useRef<AbortController|null>(null)
 const load=useCallback(async(append=false,current:Inventory|null=null)=>{
  const token=++generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;const timeout=setTimeout(()=>abort.abort(),15000)
  setBusy(true);setError(null);if(!append)setData(null)
  try{const q=new URLSearchParams({propertyId,kind:view.kind});if(view.groupKey)q.set('groupKey',view.groupKey);if(append&&current){q.set('offset',String(current.nextOffset));q.set('expectedHash',current.inventoryHash)}
   const response=await fetch(`/api/community/knowledge-inventory?${q}`,{cache:'no-store',signal:abort.signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'Saved knowledge is unavailable.')
   if(result.state!=='ready'||result.propertyId!==propertyId||result.kind!==view.kind||result.groupKey!==(view.groupKey??null)||!Array.isArray(result.items)||!result.summary||typeof result.inventoryHash!=='string')throw new Error('The knowledge inventory response could not be verified.')
   if(token===generation.current)setData({...result,items:append&&current?[...current.items,...result.items]:result.items})
  }catch(e){if(token===generation.current)setError(e instanceof Error&&e.name!=='AbortError'?e.message:'Knowledge reading timed out. Reload the inventory to try again.')}finally{clearTimeout(timeout);if(token===generation.current)setBusy(false)}
 },[propertyId,view.kind,view.groupKey])
 const cancel=useCallback(()=>{generation.current++;controller.current?.abort()},[])
 useEffect(()=>{void load();return cancel},[load,cancel])
 function navigate(kind:Kind,groupKey?:string){const u=new URL(window.location.href);if(groupKey)u.searchParams.set('knowledgeGroup',groupKey);else u.searchParams.delete('knowledgeGroup');window.history.replaceState(null,'',u);setView({kind,groupKey})}
 return <section aria-label="Saved knowledge inventory" className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-900">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Saved knowledge inventory</h3><button type="button" className={button} disabled={busy} onClick={()=>void load()}>Reload inventory</button></div>
  <p className="text-sm text-slate-600">These are stored sources and text chunks. Recorded processing status does not confirm that an assistant has reviewed or used them. Reading this inventory does not run an import or train a model.</p>
  {error&&<div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><p>{error}</p>{data&&<p>The displayed page is from the earlier read.</p>}<button type="button" className={`${button} mt-2`} onClick={()=>void load()}>Retry reading knowledge</button></div>}
  {busy&&<p role="status">Reading saved knowledge…</p>}
  {data&&<>
   <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Source records',data.summary.sourceCount],['Material groups',data.summary.documentGroups],['Text chunks',data.summary.chunkCount],['Chunks with search data',data.summary.embeddedChunks]].map(([label,value])=><div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="text-xl font-semibold">{Number(value).toLocaleString()}</dd></div>)}</dl>
   <p className="text-xs text-slate-500">Read {date(data.readAt)}. Source records and material groups are counted separately; older records may not contain a reliable link between them.</p>
  </>}
  <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-pressed={view.kind==='sources'} onClick={()=>navigate('sources')}>Source records</button><button type="button" className={button} aria-pressed={view.kind==='documents'} onClick={()=>navigate('documents')}>Stored material</button></div>
  {data&&<>
   <p className="text-sm">Showing {data.items.length.toLocaleString()} of {data.total.toLocaleString()} {view.kind==='sources'?'source records':view.kind==='documents'?'material groups':'text chunks'}.</p>
   {data.total===0&&<p className="rounded-lg bg-slate-50 p-4 text-sm">No {view.kind==='sources'?'source records':'stored material'} in this property.</p>}
   <ul aria-label={view.kind==='sources'?'Saved source records':view.kind==='documents'?'Stored material groups':'Stored text chunks'} className="space-y-3">
    {data.items.map(item=><li key={item.id||item.key} className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-4 text-sm break-words">
     {view.kind==='sources'?<><h4 className="font-semibold">{item.source_name}</h4><p>Type: {item.source_type} · Recorded status: {item.status}</p>{item.file_name&&<p>File: {item.file_name}</p>}{item.source_url&&<p className="break-all">Source address: {externalUrl(item.source_url)?<a className="underline" href={externalUrl(item.source_url)!} target="_blank" rel="noreferrer">{item.source_url}</a>:'Unsupported or credential-bearing address'}</p>}<p>Reported chunks: {item.documents_created??'Not recorded'} · Recorded last sync: {date(item.last_synced_at)}</p>{item.provenance&&Object.entries(item.provenance).map(([k,v])=><p key={k} className="break-all">{provenanceLabels[k]||k}: {v}</p>)}{item.error_message&&<p className="text-red-700">Recorded error: {item.error_message}</p>}</>:
      view.kind==='documents'?<><h4 className="font-semibold">{item.title}</h4><p>{item.chunkCount} chunks · {item.embeddedChunks} with stored search data</p><p>{item.identityBasis==='legacy_labels'?'Legacy grouping by source label and title; original file identity is not verified.':item.identityBasis==='individual_chunk'?'No recorded source identity; shown as an individual chunk.':item.identityBasis==='ingestion_run'?'Grouped by the recorded ingestion run.':'Grouped by the reported knowledge-source identity.'}</p><p>Latest stored chunk: {date(item.lastCreatedAt)}</p><button type="button" className={button} onClick={()=>navigate('chunks',item.key)}>Inspect stored chunks</button></>:
      <><h4 className="font-semibold">{item.chunkIndex==null?'Stored chunk':`Recorded chunk ${item.chunkIndex+1}`}</h4><p>{item.characterCount?.toLocaleString()} characters · {item.hasEmbedding?'Stored search data present':'No stored search data'}</p>{item.previewTruncated&&<p className="text-amber-800">Preview shows the first 10,000 characters; the saved chunk is longer.</p>}<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-sans">{item.content}</pre></>}
    </li>)}
   </ul>
   {data.nextOffset!==null&&<button type="button" className={button} disabled={busy||!!error} onClick={()=>void load(true,data)}>Load more {view.kind==='sources'?'sources':view.kind==='documents'?'material':'chunks'}</button>}
  </>}
 </section>
}
