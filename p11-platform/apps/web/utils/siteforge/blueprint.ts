import {
  blueprintPatchOperationsSchema,
  siteConfigurationSchema,
  type GeneratedPage,
  type PageSection,
  type SiteBlueprint,
  type SiteConfiguration,
  type ACFBlockType,
  type BlueprintPatchOperation,
} from '@/types/siteforge'

// Re-export for convenience
export type { BlueprintPatchOperation }

export const DEFAULT_SITE_CONFIGURATION: SiteConfiguration = siteConfigurationSchema.parse({
  design: {
    colors: {
      primary: '#1a1a1a',
      secondary: '#c9a96e',
      accent: '#8a6d3b',
      background: '#ffffff',
      text: '#1a1a1a',
    },
    typography: {
      headingFont: 'Cormorant Garamond, serif',
      bodyFont: 'Inter, sans-serif',
      headingWeight: 600,
    },
    spacing: { containerMaxWidth: '1400px', sectionPadding: '6rem' },
  },
  header: {
    layout: 'logo-left',
    position: 'sticky',
    announcement: { enabled: true, text: 'Distinctive living, thoughtfully designed' },
    cta: { enabled: true, label: 'Schedule a tour', href: '/schedule-a-tour/' },
  },
  navigation: { style: 'horizontal', items: [] },
  footer: {
    layout: 'columns',
    showNavigation: true,
    showContact: true,
    showSocial: true,
  },
  media: { imageTreatment: 'natural' },
  motion: {
    level: 'subtle',
    reducedMotion: 'respect',
    reveal: 'fade',
    durationMs: 300,
    easing: 'ease-out',
  },
  behavior: {
    smoothScroll: true,
    externalLinksNewTab: false,
    backToTop: false,
    cookieConsent: 'required',
  },
})

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
  const validatedOps = blueprintPatchOperationsSchema.parse(ops)
  const next: SiteBlueprint = {
    ...blueprint,
    pages: blueprint.pages.map(p => ({ ...p, sections: (p.sections || []).map(s => ({ ...s })) })),
    siteConfiguration: structuredClone(blueprint.siteConfiguration || DEFAULT_SITE_CONFIGURATION),
  }

  for (const op of validatedOps) {
    if (op.op === 'page.upsert') {
      const page = ensureSectionIds([op.page])[0]
      const index = next.pages.findIndex(candidate => candidate.slug === page.slug)
      if (index >= 0) next.pages[index] = page
      else next.pages.push(page)
      continue
    }

    if (op.op === 'page.remove') {
      next.pages = next.pages.filter(page => page.slug !== op.pageSlug)
      continue
    }

    if (op.op === 'section.upsert') {
      const page = next.pages.find(candidate => candidate.slug === op.pageSlug)
      if (!page) continue
      const existing = op.sectionId
        ? page.sections.find(candidate => candidate.id === op.sectionId)
        : undefined
      if (existing) {
        Object.assign(existing, op.section)
      } else {
        insertSection(page, {
          ...op.section,
          id: op.sectionId || globalThis.crypto?.randomUUID?.() || fallbackId(),
          order: 9999,
        }, op.afterSectionId)
      }
      continue
    }

    if (op.op === 'section.update') {
      const hit = findSection(next.pages, op.sectionId)
      if (hit) Object.assign(hit.section, op.value)
      continue
    }

    if (op.op === 'section.remove') {
      for (const page of next.pages) {
        page.sections = page.sections.filter(section => section.id !== op.sectionId)
      }
      continue
    }

    if (op.op === 'section.move') {
      const hit = findSection(next.pages, op.sectionId)
      if (!hit) continue
      if (op.pageSlug && hit.page.slug !== op.pageSlug) {
        const destination = next.pages.find(page => page.slug === op.pageSlug)
        if (destination) {
          hit.page.sections = hit.page.sections.filter(section => section.id !== op.sectionId)
          destination.sections.push(hit.section)
        }
      }
      hit.section.order = op.toOrder
      continue
    }

    const configurationKey = semanticConfigurationKey(op.op)
    if (configurationKey && 'value' in op) {
      const current = next.siteConfiguration?.[configurationKey]
      next.siteConfiguration = {
        ...(next.siteConfiguration || DEFAULT_SITE_CONFIGURATION),
        [configurationKey]: deepMerge(current, op.value),
      }
      continue
    }

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
      const newSection: PageSection = {
        ...op.section,
        id: globalThis.crypto?.randomUUID?.() || fallbackId(),
        order: 9999, // normalized later
      }
      insertSection(page, newSection, op.afterSectionId)
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

function insertSection(page: GeneratedPage, section: PageSection, afterSectionId?: string): void {
  const sections = page.sections || []
  const index = afterSectionId
    ? sections.findIndex(candidate => candidate.id === afterSectionId)
    : -1
  if (index >= 0) sections.splice(index + 1, 0, section)
  else sections.push(section)
  page.sections = sections
}

function semanticConfigurationKey(
  op: BlueprintPatchOperation['op']
): keyof SiteConfiguration | null {
  const keys = {
    'design.update': 'design',
    'header.update': 'header',
    'navigation.update': 'navigation',
    'footer.update': 'footer',
    'media.update': 'media',
    'motion.update': 'motion',
    'behavior.update': 'behavior',
  } as const
  return op in keys ? keys[op as keyof typeof keys] : null
}

function deepMerge<T>(current: T, update: unknown): T {
  if (
    !current ||
    !update ||
    typeof current !== 'object' ||
    typeof update !== 'object' ||
    Array.isArray(current) ||
    Array.isArray(update)
  ) {
    return update as T
  }
  const result = { ...current } as Record<string, unknown>
  for (const [key, value] of Object.entries(update)) {
    result[key] = deepMerge(result[key], value)
  }
  return result as T
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

