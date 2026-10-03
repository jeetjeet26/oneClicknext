'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {AuditEvidence} from './AuditEvidence';
import {auditButton} from './AuditDecisionHistory';
type Receipt={id:string;kind:string;created_at:string;applied_at:string|null;held_reason:string|null;payload?:unknown;payload_hash:string};
type Page={items:Receipt[];count:number;offset:number;hash:string};
export function AuditCrawlReceipts({actorId,propertyId,crawlId,version}:{actorId:string;propertyId:string;crawlId:string;version:number}){
 const[data,setData]=useState<Page|null>(null),[detail,setDetail]=useState<Receipt|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),active=useRef<AbortController|null>(null);
 const read=useCallback(async(offset=0,hash?:string,id?:string)=>{
  active.current?.abort();const abort=new AbortController();active.current=abort;setBusy(true);setError('');
  try{
   const params=new URLSearchParams({propertyId,crawlId,offset:String(offset)});if(hash)params.set('hash',hash);if(id)params.set('id',id);
   const response=await fetch(`/api/propertyaudit/crawl-receipts?${params}`,{cache:'no-store',signal:abort.signal});const result=await response.json();
   if(!response.ok)throw new Error(result.error||'Captured evidence unavailable.');
   if(result.actorId!==actorId||result.propertyId!==propertyId||result.crawlId!==crawlId||(id&&result.id!==id))throw new Error('The current account or crawl changed. Reload this workspace.');
   if(!abort.signal.aborted){if(id)setDetail(result.record);else{setData(result);setDetail(null);}}
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Captured evidence unavailable.');}
  finally{if(!abort.signal.aborted)setBusy(false);}
 },[actorId,propertyId,crawlId]);
 useEffect(()=>{if(actorId&&propertyId)void read();return()=>active.current?.abort();},[read,actorId,propertyId,version]);
 return <section aria-label="Captured crawl output" className="space-y-3 rounded border border-border p-3"><h4 className="font-medium">Captured crawl output</h4><p className="text-sm text-muted-foreground">Saved page records, progress and detector results. Retained output may remain unapplied after a stop or access change. Stored page records contain bounded extracted content, not complete original web responses.</p><button className={auditButton} disabled={busy} onClick={()=>void read()}>Refresh captured output</button>{error&&<p role="alert">{error}</p>}{data&&<><p className="text-sm">{data.count} retained captures · {data.count?data.offset+1:0}–{Math.min(data.offset+data.items.length,data.count)}</p><ul className="space-y-2">{data.items.map(r=><li key={r.id} className="rounded border border-border p-2"><p className="text-sm">{r.kind} · {r.applied_at?'Applied':'Retained; not applied'} · {new Date(r.created_at).toLocaleString()}</p>{r.held_reason&&<p className="text-sm text-muted-foreground">Hold: {r.held_reason.replaceAll('_',' ')}</p>}<button className={auditButton} disabled={busy} onClick={()=>void read(data.offset,data.hash,r.id)}>Inspect captured {r.kind}</button></li>)}</ul><div className="flex flex-wrap gap-2"><button className={auditButton} disabled={busy||data.offset===0} onClick={()=>void read(Math.max(0,data.offset-25),data.hash)}>Previous captures</button><button className={auditButton} disabled={busy||data.offset+data.items.length>=data.count} onClick={()=>void read(data.offset+25,data.hash)}>Next captures</button></div></>}{detail&&<details open><summary>Exact retained crawl payload</summary><div className="mt-2 max-h-96 overflow-auto rounded border border-border p-3"><AuditEvidence value={detail}/></div></details>}</section>;
}
