'use client'

import {useState} from 'react'
import {useSearchParams} from 'next/navigation'
import {WorkspaceDisclosure} from '@/components/ui/WorkspaceSection'
import {KnowledgeInventory} from './KnowledgeInventory'
import {KnowledgeWebsitesWorkbench} from './KnowledgeWebsitesWorkbench'
import {KnowledgeFilesWorkbench} from './KnowledgeFilesWorkbench'
import {KnowledgeWorkbench} from './KnowledgeWorkbench'
import type {KnowledgeSourceRecord} from './knowledge-presentation'

type Props = {
  sources: KnowledgeSourceRecord[]
  hasWebsiteSources?: boolean
  documentsCount: number
  uniqueDocuments: number
  categories: Record<string, number>
  insights: string[]
  propertyId: string
  onRefresh?: () => void
}


export function KnowledgeSourcesList({ propertyId, onRefresh }: Props) {
  const params = useSearchParams()
  const [chosen, setChosen] = useState<string | null>(null)
  const section = chosen ?? (params.has('knowledgeFile') ? 'files' : params.has('knowledgeSource') || params.has('knowledgeVersion') || params.has('assistantFactVersion') ? 'text' : 'websites')
  return <section className="console-panel p-4 sm:p-6 space-y-5">
    <header><h2 className="text-xl font-semibold">Review community sources</h2><p className="mt-2 text-sm text-slate-600">Choose a source, review its content, then publish the information you want the community to use. Approving a source does not approve every community fact.</p></header>
    <nav aria-label="Knowledge source types" className="workspace-tabs">
      {[['websites', 'Websites'], ['files', 'Documents'], ['text', 'Written knowledge']].map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setChosen(id)}>{label}</button>)}
    </nav>
    <div hidden={section !== 'websites'}><KnowledgeWebsitesWorkbench key={propertyId} propertyId={propertyId}/></div>
    <div hidden={section !== 'files'}><KnowledgeFilesWorkbench key={propertyId} propertyId={propertyId}/></div>
    <div hidden={section !== 'text'}><KnowledgeWorkbench key={propertyId} propertyId={propertyId} onChange={onRefresh}/></div>
    <WorkspaceDisclosure open={params.has('knowledgeGroup')} title="Source inventory and history" description="Saved versions and search preparation details"><KnowledgeInventory key={propertyId} propertyId={propertyId}/></WorkspaceDisclosure>
    <button className="console-action" type="button" onClick={() => { const section = document.getElementById('property-units-review'); const disclosure = section?.closest('details'); if (disclosure) disclosure.open = true; section?.scrollIntoView({behavior:'smooth'}); }}>Review imported floor plans</button>
  </section>
}
