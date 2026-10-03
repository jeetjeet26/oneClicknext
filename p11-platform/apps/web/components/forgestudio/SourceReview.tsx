'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {AssetPickerModal} from './AssetPickerModal'
import {savedEditorialRequest} from '@/utils/forgestudio/client'
import type {RevisionContent} from '@/utils/forgestudio/content-contract'
import type {ContextSource,SelectedAsset,ContextWarning} from '@/utils/forgestudio/context-assembler'
type Issue={code:string;label:string;sourceId?:string;rightsStatus?:string;curationStatus?:string;expiresAt?:string}
type Review={revisionId:string;state:string;previewHash:string;issues:Issue[];advisories:Issue[];sources:ContextSource[];currentSources:ContextSource[];assets:SelectedAsset[];currentAssets:SelectedAsset[];currentWarnings:ContextWarning[]}
export function SourceReview({propertyId,packageId,revisionId,content,onSaved,onStatus,onDraftChanged}:{propertyId:string;packageId:string;revisionId:string;content:RevisionContent;onSaved:()=>void;onStatus:(ready:boolean)=>void;onDraftChanged:(changed:boolean)=>void}){
 const [review,setReview]=useState<Review|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[reason,setReason]=useState(''),[claims,setClaims]=useState(content.claims),[currentMedia,setCurrentMedia]=useState(false)
 const [extraAssetIds,setExtraAssetIds]=useState<string[]>([]),[assetSelections,setAssetSelections]=useState<Record<string,string[]>>({}),[formats,setFormats]=useState<Record<string,RevisionContent['variants'][number]['contentFormat']>>({}),[picking,setPicking]=useState<string|null>(null)
 const draftChanged=JSON.stringify(claims)!==JSON.stringify(content.claims)||Object.keys(assetSelections).length>0||Object.keys(formats).length>0||currentMedia
 useEffect(()=>onDraftChanged(draftChanged),[draftChanged,onDraftChanged])
 const controller=useRef<AbortController|null>(null)
 const load=useCallback(async()=>{
  controller.current?.abort();const current=new AbortController();controller.current=current
  setLoading(true);setError(null);onStatus(false)
  try{const params=new URLSearchParams();for(const id of extraAssetIds)params.append('assetId',id);const response=await fetch(`/api/forgestudio/packages/${packageId}/sources${params.size?'?'+params:''}`,{signal:current.signal}),data=await response.json();if(!response.ok)throw new Error(data.error||'Source review unavailable');if(data.revisionId!==revisionId)throw new Error('The revision changed. Reload the saved revision.');if(current.signal.aborted)return;setReview(data);onStatus(data.state==='current')}
  catch(error){if(!current.signal.aborted){setReview(null);setError(error instanceof Error?error.message:'Source review unavailable')}}finally{if(!current.signal.aborted)setLoading(false)}
 },[packageId,revisionId,onStatus,extraAssetIds])
 useEffect(()=>{void load();return()=>controller.current?.abort()},[load])
 async function save(){if(!review)return;setSaving(true);setError(null)
  try{
   const variants=content.variants.map(v=>{
    const ids=assetSelections[v.variantKey]??v.assetIds,format=formats[v.variantKey]??v.contentFormat
    if(!currentMedia&&!assetSelections[v.variantKey]&&!formats[v.variantKey])return v
    const selected=ids.map(id=>review.currentAssets.find(a=>a.id===id))
    if(selected.some(a=>!a))throw new Error('A selected asset is unavailable. Choose an approved replacement or remove that media before refreshing.')
    const thumbnail=v.thumbnailAssetId&&review.currentAssets.some(a=>a.id===v.thumbnailAssetId)?v.thumbnailAssetId:null
    return {...v,assetIds:ids,mediaUrls:selected.map(a=>a!.fileUrl),thumbnailAssetId:thumbnail,contentFormat:format}
   })
   const request=await savedEditorialRequest('sources-'+packageId,{expectedRevisionId:revisionId,previewHash:review.previewHash,extraAssetIds,reason:reason.trim(),content:{...content,claims,variants}})
   const response=await fetch(`/api/forgestudio/packages/${packageId}/sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)}),data=await response.json()
   if(!response.ok)throw new Error(data.error||'Source review could not be saved')
   request.acknowledge();onSaved()
  }catch(error){setError(error instanceof Error?error.message:'Source review could not be saved')}finally{setSaving(false)}
 }
 return <section aria-label="Source review" className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Sources</h4><button type="button" disabled={loading||saving} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>void load()}>Reload sources</button></div>
  {loading&&<p className="text-sm">Checking saved evidence…</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {review&&<><p className="text-sm">{review.state==='current'?'The referenced records still match the saved evidence. Review whether each source supports the actual wording.':'Evidence needs review before approval or scheduling. Correct the wording and claims, then save a refreshed revision.'}</p>
   {review.issues.length>0&&<ul className="space-y-1 text-sm text-amber-800">{review.issues.map((i,n)=><li key={n}>{i.label}: {i.code.replaceAll('_',' ')}</li>)}</ul>}
   {review.advisories.map((a,n)=><p key={n} className="text-sm text-amber-800">{a.label} — rights: {a.rightsStatus}; curation: {a.curationStatus}{a.expiresAt?`; expiry: ${new Date(a.expiresAt).toLocaleDateString()}`:''}. Advisory metadata for your review.</p>)}
   <details><summary className="cursor-pointer text-sm font-medium">Compare saved and current evidence</summary><div className="mt-3 space-y-3">{Array.from(new Set([...review.sources,...review.currentSources].filter(s=>s.kind!=='performance_signal').map(s=>s.id))).map(id=>{const saved=review.sources.find(s=>s.id===id),current=review.currentSources.find(s=>s.id===id);return <div key={id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><p className="font-medium">{current?.label||saved?.label}</p><div className="mt-2 grid gap-3 md:grid-cols-2"><div><p className="text-xs font-medium">Saved evidence</p><p className="whitespace-pre-wrap break-words">{saved?.content||'Not in the saved context'}</p></div><div><p className="text-xs font-medium">Current evidence</p><p className="whitespace-pre-wrap break-words">{current?.content||'No longer available'}</p></div></div></div>})}</div></details>
   <details><summary className="cursor-pointer text-sm font-medium">Correct claims and refresh evidence</summary><div className="mt-3 space-y-4">
    {claims.map((claim,index)=><fieldset key={index} className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm">Claim {index+1} · {claim.type}</legend><label className="block text-sm">Claim wording<textarea aria-label={`Claim ${index+1} wording`} className="mt-1 block w-full rounded border bg-transparent p-2" value={claim.text} maxLength={500} onChange={e=>setClaims(list=>list.map((c,n)=>n===index?{...c,text:e.target.value}:c))}/></label><p className="text-xs">Choose the current sources that support this claim.</p>{review.currentSources.filter(s=>s.allowedUses.includes('claim')&&!s.stale&&!s.conflicted).map(source=><label key={source.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={claim.citations.some(c=>c.sourceId===source.id)} onChange={e=>{const checked=e.target.checked;setClaims(list=>list.map((c,n)=>n===index?{...c,citations:checked?[...c.citations.filter(x=>x.sourceId!==source.id),{sourceId:source.id,sourceType:source.kind as RevisionContent['claims'][number]['citations'][number]['sourceType']}]:c.citations.filter(x=>x.sourceId!==source.id)}:c))}}/>{source.label}</label>)}{claim.citations.filter(c=>!review.currentSources.some(s=>s.id===c.sourceId&&s.allowedUses.includes('claim')&&!s.stale&&!s.conflicted)).map(c=><button key={c.sourceId} type="button" className="text-sm text-red-700 underline" onClick={()=>setClaims(list=>list.map((item,n)=>n===index?{...item,citations:item.citations.filter(x=>x.sourceId!==c.sourceId)}:item))}>Remove unavailable citation {c.sourceId}</button>)}</fieldset>)}
    {content.variants.map(variant=>{const ids=assetSelections[variant.variantKey]??variant.assetIds;return <fieldset key={variant.variantKey} className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm">{variant.platform} · {variant.variantKey} media</legend>
     <ul className="space-y-1">{ids.map(id=><li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{review.currentAssets.find(a=>a.id===id)?.name||review.assets.find(a=>a.id===id)?.name||'Unavailable selected asset'}</span><button type="button" className="underline" onClick={()=>setAssetSelections(old=>({...old,[variant.variantKey]:ids.filter(a=>a!==id)}))}>Remove from revision</button></li>)}</ul>
     {review.currentAssets.length>0&&<label className="block text-sm">Choose a current file or replacement<select aria-label={`${variant.platform} replacement file`} className="mt-1 block w-full rounded border bg-transparent p-2" value="" onChange={e=>{if(e.target.value)setAssetSelections(old=>({...old,[variant.variantKey]:[e.target.value]}))}}><option value="">Select a reviewed library file</option>{review.currentAssets.map(a=><option value={a.id} key={a.id}>{a.name} · {a.assetType}</option>)}</select></label>}
     <button className="rounded border px-3 py-2 text-sm" type="button" onClick={()=>setPicking(variant.variantKey)}>Add library media</button>
     <label className="block text-sm">Content format<select aria-label={`${variant.platform} content format`} value={formats[variant.variantKey]??variant.contentFormat} className="ml-2 rounded border bg-transparent p-2" onChange={e=>setFormats(old=>({...old,[variant.variantKey]:e.target.value as RevisionContent['variants'][number]['contentFormat']}))}>{['text','image','video','reel','carousel','story'].map(f=><option key={f}>{f}</option>)}</select></label>
    </fieldset>})}
    {content.variants.some(v=>v.assetIds.length>0)&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={currentMedia} onChange={e=>setCurrentMedia(e.target.checked)}/>Use the current library files for retained media</label>}
    {draftChanged&&<button type="button" className="rounded border px-3 py-2 text-sm" onClick={()=>{setClaims(content.claims);setAssetSelections({});setFormats({});setCurrentMedia(false)}}>Discard source edits</button>}
    <label className="block text-sm">Reason for refreshing sources<textarea className="mt-1 block w-full rounded border bg-transparent p-2" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
    <p className="text-xs text-slate-500">This saves a new pending revision with your current caption edits. Review and approve that revision separately. Unstarted schedules for the old revision are cancelled. No model request is made.</p>
    {review.currentWarnings.map((w,n)=><p key={n} className="text-xs text-amber-800">{w.message}</p>)}
    <button type="button" disabled={saving||loading||reason.trim().length<3||claims.some(c=>!c.text.trim())} onClick={()=>void save()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving?'Saving refreshed revision…':'Save refreshed revision'}</button>
   </div></details>
  </>}
  {picking&&<AssetPickerModal propertyId={propertyId} onClose={()=>setPicking(null)} onSelect={asset=>{const key=picking;setExtraAssetIds(old=>old.includes(asset.id)?old:[...old,asset.id]);setAssetSelections(old=>({...old,[key]:[...new Set([...(old[key]??content.variants.find(v=>v.variantKey===key)?.assetIds??[]),asset.id])]}));setFormats(old=>({...old,[key]:asset.asset_type==='video'?'video':(content.variants.find(v=>v.variantKey===key)?.contentFormat==='carousel'?'carousel':'image')}));setPicking(null)}}/>}
 </section>
}
