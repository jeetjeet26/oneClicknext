'use client'
import {useState} from 'react'
import {savedEditorialRequest} from '@/utils/forgestudio/client'
import type {LibraryAsset} from '@/utils/forgestudio/asset-library'
export function AssetUploadForm({propertyId,replacing,onSaved,onRequestChanged}:{propertyId:string;replacing?:LibraryAsset;onSaved:(asset:LibraryAsset,message:string)=>void;onRequestChanged:()=>void}){
 const [file,setFile]=useState<File|null>(null),[name,setName]=useState(''),[description,setDescription]=useState(''),[alt,setAlt]=useState(''),[folder,setFolder]=useState(replacing?.folder??''),[rights,setRights]=useState('unknown'),[license,setLicense]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function save(){if(!file)return;setBusy(true);setError('')
  try{
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')
   const input={propertyId,contentHash:hash,fileName:file.name,name:name.trim()||file.name,size:file.size,mime:file.type,description,altText:alt,folder,rightsStatus:rights,license,...(replacing?{replacesAssetId:replacing.id,expectedRevision:replacing.governance_revision,reason:reason.trim()}:{})}
   const request=await savedEditorialRequest('asset-upload',input),form=new FormData();form.set('file',file)
   for(const [key,value] of Object.entries({...input,requestId:request.body.requestId}))form.set(key,String(value))
   const response=await fetch('/api/forgestudio/assets',{method:'POST',body:form}),data=await response.json()
   if(!response.ok)throw new Error(data.error||'Upload could not be confirmed')
   request.acknowledge();onSaved(data.asset,data.duplicate?'This file is already in the library. Its existing details were retained.':'File saved. Review its details and approval before using it in a campaign.')
  }catch(error){setError(error instanceof Error?error.message:'Upload could not be confirmed')}finally{setBusy(false);onRequestChanged()}
 }
 return <form onSubmit={e=>{e.preventDefault();void save()}} className="space-y-3" aria-label={replacing?'Replace asset file':'Upload asset file'}>
  {replacing&&<p className="text-sm">A replacement gets its own file and approval. The original is archived and remains in saved campaign history.</p>}
  <label className="block text-sm">Asset file<input aria-label="Asset file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)} className="mt-1 block w-full"/></label>
  <p className="text-xs text-slate-500">Images up to 20 MB; MP4 or WebM video up to 100 MB. Re-select the same file and details to recover an interrupted upload.</p>
  <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Asset name<input className="mt-1 block w-full rounded border bg-transparent p-2" maxLength={255} value={name} placeholder={file?.name||'Name in your library'} onChange={e=>setName(e.target.value)}/></label><label className="block text-sm">Folder<input className="mt-1 block w-full rounded border bg-transparent p-2" maxLength={120} value={folder} onChange={e=>setFolder(e.target.value)}/></label></div>
  <label className="block text-sm">Description<textarea className="mt-1 block w-full rounded border bg-transparent p-2" maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
  <label className="block text-sm">Image description for accessibility<input className="mt-1 block w-full rounded border bg-transparent p-2" maxLength={1000} value={alt} onChange={e=>setAlt(e.target.value)}/></label>
  <label className="block text-sm">Rights status<select className="ml-2 rounded border bg-transparent p-2" value={rights} onChange={e=>setRights(e.target.value)}>{['unknown','owned','licensed','generated','restricted'].map(s=><option key={s}>{s}</option>)}</select></label>
  <label className="block text-sm">License or permission notes<textarea className="mt-1 block w-full rounded border bg-transparent p-2" maxLength={4000} value={license} onChange={e=>setLicense(e.target.value)}/></label>
  {replacing&&<label className="block text-sm">Reason for replacing<textarea className="mt-1 block w-full rounded border bg-transparent p-2" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  <button disabled={busy||!file||(!!replacing&&reason.trim().length<3)} className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{busy?'Saving file…':replacing?'Save replacement file':'Upload file'}</button>
 </form>
}
