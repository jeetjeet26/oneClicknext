'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {usePropertyContext} from '@/components/layout/PropertyContext'
import {crmResponse,savedCRMRequest} from '@/utils/crm/client'
import {CRMBulkTransfers} from '@/components/crm/CRMBulkTransfers'
import {CRMDeliveryHistory} from '@/components/crm/CRMDeliveryHistory'
import {CRMSyncMonitor} from '@/components/crm/CRMSyncMonitor'
import {CRMQualification} from '@/components/crm/CRMQualification'
import {CRMSetupChecks} from '@/components/crm/CRMSetupChecks'
import {Database,RefreshCw,ShieldCheck} from 'lucide-react'
const providers=[['yardi','Yardi'],['realpage','RealPage'],['salesforce','Salesforce'],['hubspot','HubSpot'],['lasso','Lasso']]
const fields:Record<string,string>={property_name:'Property name',first_name:'First name',last_name:'Last name',email:'Email',phone:'Phone',source:'Lead source',status:'Lead stage',move_in_date:'Move-in date',bedrooms:'Bedrooms',notes:'Notes'}
type Preview={id:string;createdAt:string;snapshot:{source:Record<string,unknown>;mapped:Record<string,unknown>;omittedFields:string[];leadId:string|null;exampleOnly:boolean}}
type Connection={id:string;platform:string;revision:number;fieldMapping:Record<string,string>;hasCredentials:boolean;reviewApproved:boolean;providerVerified:boolean;existingConnection?:boolean;upgradeReviewCount?:number;status:string;latestPreview:Preview|null}
type Lead={id:string;first_name:string|null;last_name:string|null;email:string|null}
const control='rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-600'
const primary='rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50'
export default function CRMSettingsPage(){const {currentProperty}=usePropertyContext();return currentProperty?.id?<CRMWorkspace key={currentProperty.id} propertyId={currentProperty.id} propertyName={currentProperty.name}/>:<p>Select a property to configure CRM.</p>}
function CRMWorkspace({propertyId,propertyName}:{propertyId:string;propertyName:string}){
 const alive=useRef(true),commandBusy=useRef(false),loadController=useRef<AbortController|null>(null)
 const [connection,setConnection]=useState<Connection|null>(null),[ready,setReady]=useState(false),[canManage,setCanManage]=useState(false),[multiple,setMultiple]=useState(false)
 const [platform,setPlatform]=useState('lasso'),[mapping,setMapping]=useState<Record<string,string>>({}),[replaceCredentials,setReplaceCredentials]=useState(false)
 const [credentials,setCredentials]=useState<Record<string,string>>({})
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null)
 const [deliveryReview,setDeliveryReview]=useState<{id:string;requestId:string}|null>(null)
 const [leadSearch,setLeadSearch]=useState(''),[leads,setLeads]=useState<Lead[]>([]),[leadId,setLeadId]=useState(''),[leadError,setLeadError]=useState<string|null>(null)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;loadController.current?.abort()}},[])
 const reload=useCallback(async()=>{
  loadController.current?.abort();const controller=new AbortController();loadController.current=controller
  const data=await crmResponse(await fetch(`/api/crm/workspace?propertyId=${propertyId}`,{signal:controller.signal}))
  if(!alive.current||controller.signal.aborted)return
  const rows=data.integrations as Connection[],current=rows[0]||null
  setConnection(current);setMapping(Object.fromEntries(Object.entries(current?.fieldMapping||{}).filter(([key,value])=>key in fields&&typeof value==='string')));setPlatform(current?.platform||'lasso');setCanManage(data.canManage);setMultiple(rows.length>1);setReady(true)
  setReplaceCredentials(!current?.hasCredentials)
 },[propertyId])
 useEffect(()=>{void reload().catch(err=>{if(alive.current&&err.name!=='AbortError')setError(err.message)})},[reload])
 useEffect(()=>{
  const controller=new AbortController()
  const timer=setTimeout(()=>{void fetch(`/api/leads?${new URLSearchParams({propertyId,limit:'25',search:leadSearch})}`,{signal:controller.signal}).then(crmResponse).then(data=>{if(!controller.signal.aborted){setLeads(data.leads||[]);setLeadError(null)}}).catch(err=>{if(!controller.signal.aborted){setLeads([]);setLeadError(err.message)}})},leadSearch?250:0)
  return()=>{clearTimeout(timer);controller.abort()}
 },[propertyId,leadSearch])
 const cleanedMapping=Object.fromEntries(Object.entries(mapping).map(([key,value])=>[key,value.trim()]).filter(([,value])=>value))
 const differs=JSON.stringify(Object.entries(cleanedMapping).sort())!==JSON.stringify(Object.entries(connection?.fieldMapping||{}).sort()) || replaceCredentials || platform!==connection?.platform
 const supported=providers.some(([id])=>id===platform)
 const disabled=!ready||!canManage||multiple||busy||!supported
 async function command(action:'save'|'preview'|'approve'){
  if(commandBusy.current||disabled)return
  commandBusy.current=true;setBusy(true);setError(null);setNotice(null)
  try{
   let input:Record<string,unknown>={propertyId,action}
   if(action==='save')input={...input,platform,revision:connection?.revision||0,credentials:replaceCredentials?Object.fromEntries(Object.entries(credentials).map(([key,value])=>[key,value.trim()]).filter(([,value])=>value)):null,mapping:cleanedMapping}
   else if(action==='preview')input={...input,integrationId:connection!.id,revision:connection!.revision,leadId:leadId||null}
   else input={...input,previewId:connection!.latestPreview!.id}
   const request=await savedCRMRequest(action,input)
   const result=await crmResponse(await fetch('/api/crm/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.body)}))
   if(!['applied','replayed'].includes(result.state))throw new Error('CRM result is not confirmed.')
   request.acknowledge()
   if(alive.current){if(action==='save')setCredentials({});await reload();setNotice(action==='save'?'Mapping saved for review.':action==='preview'?'Saved preview ready to review.':'Field mapping approved. Provider verification is still required before delivery.')}
  }catch(err){if(alive.current)setError(err instanceof Error?err.message:'CRM request could not be confirmed.')}
  finally{commandBusy.current=false;if(alive.current)setBusy(false)}
 }
 return <div className="mx-auto max-w-5xl space-y-6 text-gray-900 dark:text-gray-100">
  <Link href="/dashboard/settings" className="text-sm text-indigo-600 dark:text-indigo-300">← Settings</Link>
  <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Database className="text-indigo-500"/>CRM setup</h1><p className="mt-1 text-sm text-gray-500">Review field mapping and connection readiness for {propertyName}.</p></div><button className={control} disabled={busy} onClick={()=>{setError(null);void reload().catch(err=>setError(err.message))}}>Reload saved setup</button></header>
  {error&&<p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}{notice&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-950">{notice}</p>}
  {!ready?<p className="flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4 animate-spin"/>Loading saved CRM setup…</p>:<>
   {!canManage&&<p className="rounded-lg border p-3 text-sm">An administrator or manager can change CRM setup. You can review the saved state.</p>}
   {multiple&&<p role="alert" className="rounded-lg border border-amber-300 p-3 text-sm">This property has multiple CRM entries. Reconcile those connections before changing the active setup.</p>}
   <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5"/>Readiness</h2><p className="mt-2 text-sm">{connection?.existingConnection?'Existing Lasso connection preserved.':connection?.providerVerified?'Provider evidence saved.':connection?.reviewApproved?'Mapping approved · Provider verification required':'Field mapping needs review'}</p><p className="mt-1 text-xs text-gray-500">{connection?.existingConnection?'New leads continue through the saved connection. No new login or chatbot installation is needed. Changing credentials or mapping requires a new connection review.':'Saving or approving a mapping does not create a CRM record or enable delivery. Provider verification must confirm the current connection and mapping.'}</p>{connection&&<p className="mt-2 text-xs text-gray-500">Saved version {connection.revision} · {connection.hasCredentials?'Credentials saved on the server':'Credentials needed'}</p>}</section>
   {!!connection?.upgradeReviewCount&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{connection.upgradeReviewCount} older lead records need delivery review in Lasso. They are retained and will not be resent automatically. <Link className="underline" href="/dashboard/leads">Review leads</Link></p>}
   <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"><h2 className="font-semibold">Connection and field mapping</h2><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm">CRM provider<select className={`${control} mt-1 block w-full`} aria-label="CRM provider" value={platform} disabled={disabled||!!connection} onChange={e=>{setPlatform(e.target.value);setCredentials({})}}>{!supported&&<option value={platform}>Legacy CRM — provider review required</option>}{providers.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><div className="self-end text-sm">{connection?.hasCredentials&&<label className="flex items-center gap-2"><input type="checkbox" checked={replaceCredentials} disabled={disabled} onChange={e=>setReplaceCredentials(e.target.checked)}/>Replace stored credentials</label>}</div></div>
    {replaceCredentials&&<div className="mt-4 grid gap-3 md:grid-cols-2">{Object.entries(platform==='salesforce'?{access_token:'Access token',instance_url:'Salesforce instance URL'}:platform==='hubspot'?{api_key:'API key or access token'}:platform==='lasso'?{api_key:'API key or access token',api_endpoint:'API endpoint (optional)',client_id:'Client ID (optional)',project_id:'Project ID (optional)'}:{api_key:'API key or access token',api_endpoint:'API endpoint',property_code:'Property code',...(platform==='realpage'?{company_code:'Company code (optional)'}:{})}).map(([key,label])=><label key={key} className="text-sm">{label}<input autoComplete="off" type={['api_key','access_token'].includes(key)?'password':'text'} className={`${control} mt-1 block w-full`} maxLength={['api_key','access_token'].includes(key)?8192:1000} value={credentials[key]||''} disabled={disabled} onChange={({target:{value}})=>setCredentials(current=>({...current,[key]:value}))}/></label>)}<p className="text-xs text-gray-500 md:col-span-2">Existing keys are never loaded into the browser. Enter credentials only when creating or replacing a connection.</p></div>}
    <p className="mt-5 text-sm text-gray-500">Enter the CRM destination field for each value you intend to transfer. Leave a field blank to omit it. Provider field names and requirements still need verification.</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2 pr-3">Console field</th><th className="py-2">CRM destination field</th></tr></thead><tbody>{Object.entries(fields).map(([key,label])=><tr key={key} className="border-t border-gray-100 dark:border-gray-700"><td className="py-2 pr-3">{label}</td><td className="py-2"><input aria-label={`${label} CRM field`} className={`${control} w-full`} maxLength={128} value={mapping[key]||''} disabled={disabled} onChange={({target:{value}})=>setMapping(current=>({...current,[key]:value}))}/></td></tr>)}</tbody></table></div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button className={primary} disabled={disabled || !differs || (replaceCredentials&&!(credentials[platform==='salesforce'?'access_token':'api_key']||'').trim())} onClick={()=>void command('save')}>{busy?'Saving…':'Save mapping for review'}</button>{differs&&connection&&<p className="text-xs text-amber-700">Save your changes before creating or approving a preview.</p>}</div>
   </section>
   {connection&&<CRMSetupChecks key={connection.id} propertyId={propertyId} integrationId={connection.id} revision={connection.revision} disabled={disabled||differs} canManage={canManage}/>}
   {connection&&<section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"><h2 className="font-semibold">Preview and approve</h2><p className="mt-1 text-sm text-gray-500">Preview example values or select a lead. No data is sent to the CRM.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Find a lead (optional)<input className={`${control} mt-1 block w-full`} maxLength={200} value={leadSearch} onChange={e=>{setLeadSearch(e.target.value);setLeadId('')}}/></label><label className="text-sm">Preview source<select aria-label="Preview source" className={`${control} mt-1 block w-full`} value={leadId} onChange={e=>setLeadId(e.target.value)}><option value="">Example values — no real lead</option>{leads.map(lead=><option key={lead.id} value={lead.id}>{[lead.first_name,lead.last_name].filter(Boolean).join(' ')||lead.email||'Unnamed lead'}</option>)}</select></label></div>{leadError&&<p role="alert" className="mt-2 text-sm">Lead search is unavailable: {leadError}</p>}<button className={`${primary} mt-3`} disabled={disabled||differs||!Object.keys(cleanedMapping).length} onClick={()=>void command('preview')}>Create saved preview</button>
    {connection.latestPreview&&<div className="mt-5"><h3 className="font-medium">Saved {connection.latestPreview.snapshot.exampleOnly?'example':'lead'} preview</h3><p className="mt-1 text-xs text-gray-500">Version {connection.revision} · {new Date(connection.latestPreview.createdAt).toLocaleString()}</p><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2 pr-3">CRM field</th><th className="py-2">Value that would be sent</th></tr></thead><tbody>{Object.entries(connection.latestPreview.snapshot.mapped).map(([key,value])=><tr key={key} className="border-t border-gray-100 dark:border-gray-700"><td className="max-w-40 break-words py-2 pr-3">{key}</td><td className="max-w-sm whitespace-pre-wrap break-words py-2">{value===null?'Not supplied':String(value)}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-gray-500">Omitted fields: {connection.latestPreview.snapshot.omittedFields.map(key=>fields[key]||key).join(', ')||'None'}.</p><button className={`${primary} mt-4`} disabled={disabled||differs||connection.reviewApproved||connection.existingConnection} onClick={()=>void command('approve')}>{connection.existingConnection?'Existing mapping retained':connection.reviewApproved?'Mapping approved':'Approve this field mapping'}</button></div>}
   </section>}
   {connection&&!connection.existingConnection&&<CRMQualification key={connection.id+'-qualification'} propertyId={propertyId} integrationId={connection.id} revision={connection.revision} platform={connection.platform} canManage={canManage} disabled={disabled||differs} onActivated={reload}/>}
   {connection&&<CRMSyncMonitor key={connection.id+'-overview'} propertyId={propertyId} showHistory={false}/>}
   {connection&&<CRMBulkTransfers key={connection.id+'-bulk'} propertyId={propertyId} canManage={canManage} onReviewTransfer={id=>setDeliveryReview({id,requestId:crypto.randomUUID()})}/>}
   {connection&&<CRMDeliveryHistory key={connection.id+'-deliveries'} propertyId={propertyId} leadId={leadId} canManage={canManage} requestedReview={deliveryReview}/>}
  </>}
 </div>
}
