'use client'

import {FolderOpen,Link,Type,Upload} from 'lucide-react'
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


export function KnowledgeSourcesList({ 
  propertyId,
  onRefresh
}: Props) {
  return (
    <div className="space-y-6">
      {/* Sources List */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-slate-400" />
            Knowledge Sources
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => document.getElementById('knowledge-websites')?.scrollIntoView({behavior:'smooth'})}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Review retained website captures"
            >
              <Link className="h-4 w-4" />
              Website Sources
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('knowledge-workbench')?.scrollIntoView({behavior:'smooth'})}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Paste text content directly"
            >
              <Type className="h-4 w-4" />
              Reviewed Text
            </button>
            <button type="button" onClick={() => document.getElementById('property-units-review')?.scrollIntoView({behavior:'smooth'})} className="rounded-lg px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-50">Review Floor Plans</button>
            <button
              type="button"
              onClick={() => document.getElementById('knowledge-files')?.scrollIntoView({behavior:'smooth'})}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <Upload className="h-4 w-4" />
              Private Files
            </button>
          </div>
        </div>

        <div className="p-4"><KnowledgeWebsitesWorkbench key={propertyId} propertyId={propertyId}/></div>
        <div className="p-4"><KnowledgeFilesWorkbench key={propertyId} propertyId={propertyId}/></div>
        <div className="p-4"><KnowledgeWorkbench key={propertyId} propertyId={propertyId} onChange={onRefresh}/></div>
        <div className="p-4"><KnowledgeInventory key={propertyId} propertyId={propertyId}/></div>
      </div>


    </div>
  )
}

