import type { GeneratedPage, PageSection, SiteBlueprint, ACFBlockType, BlueprintPatchOperation } from '@/types/siteforge'

// Re-export for convenience
export type { BlueprintPatchOperation }

export function ensureSectionIds(pages: GeneratedPage[]): GeneratedPage[] {
  return pages.map(page => ({
    ...page,
    sections: (page.sections || []).map(section => ({
      ...normalizeLegacySection(section),
      id: section.id || globalThis.crypto?.randomUUID?.() || fallbackId(),
    })),
  }))
}

/**
 * Older generations stored the block identity as `block` instead of the
 * canonical `acfBlock`. Normalize on read so preview and deploy always see
 * `acfBlock`.
 */
export function normalizeLegacySection(section: PageSection): PageSection {
  const legacy = section as PageSection & { block?: string }
  if (legacy.acfBlock || !legacy.block) {
    return section
  }
  const { block, ...rest } = legacy
  return { ...rest, acfBlock: block as ACFBlockType }
}

export function normalizeLegacyPages(pages: GeneratedPage[]): GeneratedPage[] {
  return pages.map(page => ({
    ...page,
    sections: (page.sections || []).map(normalizeLegacySection),
  }))
}

export function makeBlueprintFromPages(pages: GeneratedPage[], version = 1): SiteBlueprint {
  return {
    version,
    updatedAt: new Date().toISOString(),
    pages: ensureSectionIds(pages),
  }
}

export function applyBlueprintPatch(blueprint: SiteBlueprint, ops: BlueprintPatchOperation[]): SiteBlueprint {
  const next: SiteBlueprint = {
    ...blueprint,
    pages: blueprint.pages.map(p => ({ ...p, sections: (p.sections || []).map(s => ({ ...s })) })),
  }

  for (const op of ops) {
    if (op.op === 'update_section') {
      const hit = findSection(next.pages, op.sectionId)
      if (hit) {
        if (op.content) hit.section.content = op.content
        if (op.variant) hit.section.variant = op.variant
        if (op.cssClasses) hit.section.cssClasses = op.cssClasses
        if (op.reasoning) hit.section.reasoning = op.reasoning
      }
      continue
    }

    if (op.op === 'remove_section') {
      for (const page of next.pages) {
        page.sections = (page.sections || []).filter(s => s.id !== op.sectionId)
      }
      continue
    }

    if (op.op === 'move_section') {
      const hit = findSection(next.pages, op.sectionId)
      if (hit) {
        hit.section.order = op.toOrder
      }
      continue
    }

    if (op.op === 'add_section') {
      const page = next.pages.find(p => p.slug === op.pageSlug)
      if (!page) continue
      const sections = page.sections || []
      const newSection: PageSection = {
        ...op.section,
        id: globalThis.crypto?.randomUUID?.() || fallbackId(),
        order: 9999, // normalized later
      }

      if (op.afterSectionId) {
        const idx = sections.findIndex(s => s.id === op.afterSectionId)
        if (idx >= 0) {
          sections.splice(idx + 1, 0, newSection)
        } else {
          sections.push(newSection)
        }
      } else {
        sections.push(newSection)
      }
      page.sections = sections
      continue
    }
  }

  // normalize order fields per page
  next.pages = next.pages.map(page => ({
    ...page,
    sections: normalizeOrder(page.sections || []),
  }))

  return {
    ...next,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeOrder(sections: PageSection[]): PageSection[] {
  const sorted = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return sorted.map((s, i) => ({ ...s, order: i + 1 }))
}

function findSection(pages: GeneratedPage[], sectionId: string): { page: GeneratedPage; section: PageSection } | null {
  for (const page of pages) {
    for (const section of page.sections || []) {
      if (section.id === sectionId) return { page, section }
    }
  }
  return null
}

function fallbackId(): string {
  return `sec_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

