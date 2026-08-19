'use client'

import { ACFBlockRenderer } from '@/components/siteforge/ACFBlockRenderer'

export interface InventoryPreviewBlock {
  pageSlug: string
  pageTitle: string
  sectionId: string
  variant?: string
  content: Record<string, unknown>
}

export function InventoryRevisionPreview({
  blocks,
}: {
  blocks: InventoryPreviewBlock[]
}) {
  return (
    <div className="space-y-5" data-testid="inventory-revision-preview">
      {blocks.map((block) => (
        <section key={`${block.pageSlug}:${block.sectionId}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Exact SiteForge block preview
            </p>
            <h3 className="font-semibold text-slate-900">{block.pageTitle}</h3>
          </div>
          <ACFBlockRenderer
            blockType="acf/plans-availability"
            blockIdentity={block.sectionId}
            content={block.content}
            variant={block.variant}
          />
        </section>
      ))}
    </div>
  )
}
