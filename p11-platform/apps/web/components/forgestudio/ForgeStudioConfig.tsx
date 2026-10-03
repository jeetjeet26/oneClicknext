'use client'
import {useCallback,useEffect,useId,useRef,useState} from 'react'
import {Loader2,Save} from 'lucide-react'
import {studioConfigurationSchema,type StudioConfiguration} from '@/utils/forgestudio/configuration'
type Saved={config:StudioConfiguration;version:number;isDefault?:boolean}
const inputClass='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white'
export function ForgeStudioConfig({propertyId}:{propertyId:string}){
 const fieldId=useId()
 const [saved,setSaved]=useState<Saved|null>(null),[draft,setDraft]=useState<StudioConfiguration|null>(null),[amenities,setAmenities]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null)
 const pending=useRef<{key:string;id:string}|null>(null),controller=useRef<AbortController|null>(null)
 const reload=useCallback(async()=>{
  controller.current?.abort();const abort=new AbortController();controller.current=abort;setLoading(true);setError(null);setMessage(null);setSaved(null);setDraft(null);pending.current=null
  try{const r=await fetch(`/api/forgestudio/config?propertyId=${propertyId}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])}),data=await r.json();if(!r.ok)throw new Error(data.error||'Settings could not be loaded');if(abort.signal.aborted)return;setSaved(data);setDraft(data.config);setAmenities(data.config.key_amenities.join(', '))}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Settings could not be loaded')}finally{if(!abort.signal.aborted)setLoading(false)}
 },[propertyId])
 useEffect(()=>{void reload();return()=>controller.current?.abort()},[reload])
 async function save(e:React.FormEvent){
  e.preventDefault();if(!draft||!saved)return
  const parsed=studioConfigurationSchema.safeParse({...draft,key_amenities:amenities.split(',').map(s=>s.trim()).filter(Boolean)})
  if(!parsed.success){setError('Check the settings: up to 30 amenities, 120 characters each, and a caption limit from 50 to 10,000.');return}
  const body={propertyId,expectedVersion:saved.version,config:parsed.data},key=JSON.stringify(body);if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()}
  setSaving(true);setError(null);setMessage(null)
  const abort=new AbortController();controller.current=abort
  try{const r=await fetch('/api/forgestudio/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:pending.current.id}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])}),data=await r.json();if(!r.ok)throw new Error(data.error||'Settings could not be saved');if(abort.signal.aborted)return;setSaved(data);setDraft(data.config);setAmenities(data.config.key_amenities.join(', '));pending.current=null;setMessage('Settings saved. New generation requests will use these preferences. Existing drafts retain their original settings.')}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'The save response was interrupted. Retry the same save to confirm its result.')}finally{if(!abort.signal.aborted)setSaving(false)}
 }
 return <section aria-label="Studio settings" className="max-w-3xl space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Studio settings</h2><button type="button" disabled={saving||loading} onClick={()=>void reload()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Reload saved settings</button></div>
  <p className="text-sm text-slate-500">Preferences for future campaign drafts. Model and media choices are made in each generation request. Publication still requires a reviewed draft and a separate schedule decision.</p>
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
  {loading?<p role="status" className="flex gap-2"><Loader2 className="h-5 w-5 animate-spin"/>Loading saved settings…</p>:draft&&saved?<form aria-label="Studio preferences" onSubmit={save} className="space-y-4">
   {saved.isDefault&&<p className="text-sm text-slate-500">Using defaults. Save to record this property’s preferences.</p>}
   <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
    <div className="space-y-1"><label htmlFor={fieldId+'-voice'}>Brand voice</label><textarea id={fieldId+'-voice'} maxLength={2000} rows={3} value={draft.brand_voice??''} onChange={e=>setDraft({...draft,brand_voice:e.target.value||null})} className={inputClass} placeholder="Leave blank to use the property’s brand voice"/></div>
    <div className="space-y-1"><label htmlFor={fieldId+'-audience'}>Audience interests</label><input id={fieldId+'-audience'} maxLength={1000} value={draft.target_audience??''} onChange={e=>setDraft({...draft,target_audience:e.target.value||null})} className={inputClass} placeholder="For example: outdoor spaces, flexible layouts, nearby transit"/></div>
    <div className="space-y-1"><label htmlFor={fieldId+'-amenities'}>Amenity topics (comma-separated)</label><textarea id={fieldId+'-amenities'} rows={2} value={amenities} onChange={e=>setAmenities(e.target.value)} className={inputClass} placeholder="Pool, fitness center, rooftop lounge"/></div>
    <p className="text-xs text-slate-500">Amenity topics guide ideas. Public claims still need supporting property evidence.</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.include_hashtags} onChange={e=>setDraft({...draft,include_hashtags:e.target.checked})}/>Allow hashtags in generated drafts</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.include_cta} onChange={e=>setDraft({...draft,include_cta:e.target.checked})}/>Allow a call-to-action in generated drafts</label>
    <div className="space-y-1"><label htmlFor={fieldId+'-length'}>Maximum caption length</label><input id={fieldId+'-length'} type="number" required min={50} max={10000} step={1} value={draft.max_caption_length} onChange={e=>setDraft({...draft,max_caption_length:Number(e.target.value)})} className={inputClass}/></div>
    <p className="text-xs text-slate-500">Includes hashtags. A channel’s smaller limit takes precedence. Saved preferences guide generation; manually edited drafts remain subject to content review.</p>
   </fieldset>
   <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-white disabled:opacity-50">{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}Save settings</button>
  </form>:null}
 </section>
}
