'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { buildSiteForgeCodexBrief, siteForgeBriefFilename, type SiteForgeTarget } from '@/utils/siteforge/codex-brief'

import {SiteForgeBriefHistory}from './SiteForgeBriefHistory'
import {briefDraftKey,briefRequest,reserveBriefReport,reportBriefExport,type SavedBrief}from '@/utils/siteforge/brief-history-client'

interface Props {
  property: { id: string; name: string; city?: string }
}

const fieldClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

export function SiteForgeCodexBrief({ property }: Props) {
  const [request, setRequest] = useState('')
  const [references, setReferences] = useState('')
  const [revision, setRevision] = useState({ keepUnchanged: '', parentVersion: '' })
  const [delivery, setDelivery] = useState({ projectLocation: '', contentOwnership: '', inquiryDestination: '' })
  const [target, setTarget] = useState<SiteForgeTarget>('existing')
  const [feedback, setFeedback] = useState('')
  const [copying, setCopying] = useState(false)
  const [savedId,setSavedId]=useState<string|null>(null),[historyRefresh,setHistoryRefresh]=useState(0),[pendingBrief,setPendingBrief]=useState<SavedBrief|null>(null)
  const lastSaved=useRef<{key:string;id:string;document:string}|null>(null),parent=useRef<string|null>(null),generation=useRef(0)
  useEffect(()=>()=>{generation.current++},[])
  const preview = useRef<HTMLDetailsElement>(null)
  const canExport = Boolean(request.trim())
  const brief = canExport ? buildSiteForgeCodexBrief({ property, request, references, target, delivery, revision }) : ''

  function clearFeedback() { setFeedback('') }

  const draft={request,references,target,delivery,revision}
  const propertySnapshot={...property,city:property.city||null}
  const draftKey=briefDraftKey(propertySnapshot,draft)
  async function persistBrief(){
    if(lastSaved.current?.key===draftKey)return lastSaved.current
    const result=await briefRequest('',{propertyId:property.id,parentId:lastSaved.current?.id??parent.current,property:propertySnapshot,draft},['saved','replayed'])
    const saved={key:draftKey,id:result.briefId as string,document:result.document as string}
    return saved
  }
  function acceptSaved(saved:{key:string;id:string;document:string}){
    lastSaved.current=saved;setSavedId(saved.id);setHistoryRefresh(v=>v+1)
    const url=new URL(location.href);url.searchParams.set('codexBriefId',saved.id);url.searchParams.set('briefPropertyId',property.id);history.replaceState(null,'',url)
  }
  async function saveBrief(){const turn=generation.current;setCopying(true);setFeedback('');try{const saved=await persistBrief();if(turn!==generation.current)return;acceptSaved(saved);setFeedback('Brief saved. Its exact text is available in saved history.')}catch(e){if(turn===generation.current)setFeedback(e instanceof Error?e.message:'The brief could not be saved.')}finally{if(turn===generation.current)setCopying(false)}}
  async function handoff(mode:'copy'|'download'){
    const turn=generation.current;setCopying(true);setFeedback('')
    try{
      const saved=await persistBrief();if(turn!==generation.current)return;acceptSaved(saved)
      if(saved.document!==brief)throw new Error('Saved instructions differ from the current preview. Reload and review the saved brief before handing it off.')
      const prepared=await briefRequest('/export',{action:'prepare',propertyId:property.id,briefId:saved.id,mode},['prepared','replayed']);if(turn!==generation.current)return
      if(prepared.document!==saved.document)throw new Error('The prepared handoff differs from the saved brief. Review saved history before continuing.')
      reserveBriefReport(prepared.exportId)
      let result:'clipboard_succeeded'|'clipboard_failed'|'download_started'|'download_failed'
      let message:string
      if(mode==='copy'){
        try{await navigator.clipboard.writeText(saved.document);result='clipboard_succeeded';message='Brief copied. Paste it into Codex in the client’s project.'}
        catch{result='clipboard_failed';if(preview.current)preview.current.open=true;message='Clipboard access is unavailable. Copy the brief from the preview below or download it.'}
      }else{
        try{const url=URL.createObjectURL(new Blob([saved.document],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=siteForgeBriefFilename(property.name);document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);result='download_started';message='Brief download started. Confirm the saved file before adding it to the client’s project.'}
        catch{result='download_failed';message='The download could not be started. The exact brief remains in saved history.'}
      }
      try{await reportBriefExport({propertyId:property.id,exportId:prepared.exportId,result})}catch{message+=' The browser outcome report is pending; reload saved history to retry recording it.'}
      if(turn===generation.current){setFeedback(message);setHistoryRefresh(v=>v+1)}
    }catch(e){if(turn===generation.current)setFeedback(e instanceof Error?e.message:'The handoff could not be confirmed. Retry the same brief.')}finally{if(turn===generation.current)setCopying(false)}
  }
  function openBriefFields(saved:SavedBrief){
    if(copying)return
    const apply=()=>{const d=saved.input.draft;setRequest(d.request);setReferences(d.references);setTarget(d.target);setDelivery(d.delivery);setRevision(d.revision);parent.current=saved.id;lastSaved.current={key:briefDraftKey(saved.input.property,d),id:saved.id,document:saved.document};setPendingBrief(null);setFeedback('Saved fields opened for revision. Changes create a new snapshot and retain this parent.')}
    if(request.trim()&&lastSaved.current?.key!==draftKey&&pendingBrief?.id!==saved.id){setPendingBrief(saved);return}apply()
  }

  return (
    <>
    <section aria-labelledby="codex-brief-heading" className="rounded-xl border border-indigo-200 bg-white p-5 dark:border-indigo-900 dark:bg-gray-800 sm:p-6">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Client website work</p>
        <h2 id="codex-brief-heading" className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Prepare a brief for Codex</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
          Build and revise in the client’s project using the SiteForge skill. Bring the brief, assets, and reference designs; Codex handles the implementation and checks.
        </p>
        <p className="mt-3 break-words text-sm text-gray-700 dark:text-gray-200">
          Selected property: <strong>{property.name}</strong>{property.city ? ` · ${property.city}` : ''}
        </p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={copying} className="min-w-0 space-y-4">
          <div>
            <label htmlFor="siteforge-request" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">What would you like to build or change?</label>
            <textarea id="siteforge-request" value={request} maxLength={8000} rows={5} required
              onChange={event => { setRequest(event.target.value); clearFeedback() }}
              placeholder="Describe the new site, redesign, or specific update. Include the audience, important pages, and any design requirements."
              className={fieldClass} />
          </div>
          <div>
            <label htmlFor="siteforge-references" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">References and source notes <span className="font-normal">(optional)</span></label>
            <textarea id="siteforge-references" value={references} maxLength={6000} rows={3}
              onChange={event => { setReferences(event.target.value); clearFeedback() }}
              placeholder="Reference URLs, supplied PDF or asset filenames, and where to find approved content. Add the actual files in Codex."
              aria-describedby="siteforge-reference-help" className={fieldClass} />
            <p id="siteforge-reference-help" className="mt-1.5 text-xs leading-5 text-gray-600 dark:text-gray-400">Keep passwords and private access keys out of the brief.</p>
          </div>
          <div>
            <label htmlFor="siteforge-target" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">Website platform</label>
            <select id="siteforge-target" value={target} onChange={event => { setTarget(event.target.value as SiteForgeTarget); clearFeedback() }} className={fieldClass}>
              <option value="existing">Keep the current platform; WordPress for a new site</option>
              <option value="wordpress">WordPress with editable content</option>
              <option value="standalone">Standalone website</option>
            </select>
          </div>
          <details className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">Revision details (optional)</summary>
            <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-gray-400">For an existing site, name what to preserve and which version to compare with. Codex will check the actual project before editing.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="siteforge-keep-unchanged" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">What should stay unchanged?</label>
                <textarea id="siteforge-keep-unchanged" value={revision.keepUnchanged} maxLength={3000} rows={2} placeholder="For example: keep the homepage, brand colors, approved pricing, and inquiry flow." className={fieldClass}
                  onChange={event => { setRevision(value => ({ ...value, keepUnchanged: event.target.value })); clearFeedback() }} />
              </div>
              <div>
                <label htmlFor="siteforge-parent-version" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">Version to compare with</label>
                <textarea id="siteforge-parent-version" value={revision.parentVersion} maxLength={2000} rows={2} placeholder="A dated review, saved source version, or screenshot filename, if known. Add files in Codex." className={fieldClass}
                  onChange={event => { setRevision(value => ({ ...value, parentVersion: event.target.value })); clearFeedback() }} />
              </div>
            </div>
          </details>
          <details className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">Editing and launch details (optional)</summary>
            <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-gray-400">Add what is known. Missing details stay open for the relevant step; you can still prepare the brief. Keep credentials out of these notes.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="siteforge-project-location" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">Current website or project</label>
                <textarea id="siteforge-project-location" value={delivery.projectLocation} maxLength={2000} rows={2} placeholder="Where the site and its source files live; note any separate review version." className={fieldClass}
                  onChange={event => { setDelivery(value => ({ ...value, projectLocation: event.target.value })); clearFeedback() }} />
              </div>
              <div>
                <label htmlFor="siteforge-content-ownership" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">Who updates the content?</label>
                <textarea id="siteforge-content-ownership" value={delivery.contentOwnership} maxLength={2000} rows={2} placeholder="Who confirms the facts, where approved content lives, and what the client needs to edit." className={fieldClass}
                  onChange={event => { setDelivery(value => ({ ...value, contentOwnership: event.target.value })); clearFeedback() }} />
              </div>
              <div>
                <label htmlFor="siteforge-inquiry-destination" className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-gray-200">Where should inquiries go?</label>
                <textarea id="siteforge-inquiry-destination" value={delivery.inquiryDestination} maxLength={2000} rows={2} placeholder="The intended inbox, CRM or contact workflow, if known. This does not send or connect anything." className={fieldClass}
                  onChange={event => { setDelivery(value => ({ ...value, inquiryDestination: event.target.value })); clearFeedback() }} />
              </div>
            </div>
          </details>
        </fieldset>

        <div className="rounded-lg bg-gray-50 p-5 dark:bg-gray-900/50">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">From brief to a maintainable website</h3>
          <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm leading-6 text-gray-700 dark:text-gray-300">
            <li>Open the client’s project in Codex and paste this brief with the source files.</li>
            <li>Review the actual website and its content editors. Text, images, galleries, and shared details should be easy to find and change.</li>
            <li>Verify inquiries, current property information, and recovery before launch. Publish to the agreed destination when authorized.</li>
          </ol>
          <p className="mt-5 text-sm leading-6 text-gray-600 dark:text-gray-400">Save a brief to reopen it later. Copying or downloading also saves the exact text first. Unsaved edits clear when you leave or switch properties. Keep source files and delivery evidence in the client’s project; this handoff does not start a Codex task or sync a website.</p>
        </div>
      </div>

      {pendingBrief&&<div role="alert" className="mt-4 space-y-2 rounded-lg border border-amber-300 p-3"><p>Opening this saved brief will replace the unsaved form.</p><button className={fieldClass} disabled={copying} onClick={()=>openBriefFields(pendingBrief)}>Open saved fields</button><button className={fieldClass} onClick={()=>setPendingBrief(null)}>Keep editing</button></div>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={()=>void saveBrief()} disabled={!canExport||copying} className="rounded-lg border border-indigo-300 px-4 py-2.5 text-sm font-medium text-indigo-700 disabled:opacity-50 dark:text-indigo-300">Save brief</button>
        <button type="button" onClick={() => void handoff('copy')} disabled={!canExport || copying}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50">
          <Copy size={16} aria-hidden="true" />Copy brief for Codex
        </button>
        <button type="button" onClick={() => void handoff('download')} disabled={!canExport || copying}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
          <Download size={16} aria-hidden="true" />Download brief
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-gray-700 dark:text-gray-300">{feedback}</p>
      <details ref={preview} className="mt-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">Preview the brief</summary>
        {canExport ? <textarea aria-label="Prepared Codex brief" value={brief} readOnly rows={16} className={`${fieldClass} mt-3 font-mono text-xs`} />
          : <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Describe the work to see the brief.</p>}
      </details>
    </section>
    <SiteForgeBriefHistory propertyId={property.id} openId={savedId} refresh={historyRefresh} onUse={openBriefFields} editingDisabled={copying}/>
    </>
  )
}
