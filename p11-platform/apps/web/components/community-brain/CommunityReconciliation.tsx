'use client'
import {useEffect,useRef,useState}from'react'
type Source={kind:string;id:string;source_hash:string;eligible:boolean}
type Catalog={items:Source[];total:number;nextOffset:number|null}
export function CommunityReconciliation({propertyId}:{propertyId:string}){
 const [catalog,setCatalog]=useState<Catalog|null>(null),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const requestId=useRef<string|null>(null)
 useEffect(()=>{
  let active=true;requestId.current=null
  fetch(`/api/community-brain/reconciliation?propertyId=${propertyId}&offset=${offset}`,{cache:'no-store'}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);if(active)setCatalog(v)}).catch(()=>{if(active)setMessage('Historical source review is unavailable.')})
  return()=>{active=false}
 },[propertyId,offset])
 async function rebuild(){
  if(!catalog)return;setBusy(true);setMessage('Queuing eligible source versions…')
  requestId.current??=crypto.randomUUID()
  try{
   const records=catalog.items.filter(s=>s.eligible).map(({kind,id,source_hash})=>({kind,id,source_hash}))
   const r=await fetch('/api/community-brain/reconciliation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,requestId:requestId.current,records})})
   const v=await r.json();if(!r.ok)throw Error(v.error)
   setMessage(`${v.jobIds.length} current source versions queued. Existing approvals and original files are preserved.`)
  }catch(e){setMessage(e instanceof Error?e.message:'The replay could not be confirmed. Retry uses the same saved request.')}
  finally{setBusy(false)}
 }
 const eligible=catalog?.items.filter(s=>s.eligible).length??0
 return <section className="space-y-3 rounded-xl border p-5"><h2 className="font-medium">Historical source review</h2>
 <p className="text-sm text-muted-foreground">Rebuild search from sources whose ownership, identity and approval are already established. Unlinked or unreviewed history stays unavailable until it is reviewed.</p>
 {catalog&&<p className="text-sm">{eligible} eligible sources on this page; {catalog.items.length-eligible} require review. {catalog.total} total retained sources.</p>}
 {message&&<p role="status" className="text-sm">{message}</p>}
 <div className="flex gap-3"><button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={busy||eligible===0}onClick={()=>void rebuild()}>Rebuild eligible memory</button>
 {offset>0&&<button className="text-sm underline"disabled={busy}onClick={()=>setOffset(Math.max(0,offset-100))}>Previous sources</button>}
 {catalog?.nextOffset!=null&&<button className="text-sm underline"disabled={busy}onClick={()=>setOffset(catalog.nextOffset!)}>Next sources</button>}</div></section>
}
