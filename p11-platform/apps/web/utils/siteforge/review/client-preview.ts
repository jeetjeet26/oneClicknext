import type {
  ClientSafePage,
  ClientSafePreview,
} from './contracts'

const SENSITIVE_KEY =
  /(^|[_-])(job|provider|hash|prompt|model|secret|token|credential|reasoning|evidence|photo[_-]?requirement)([_-]|$)/i
const SENSITIVE_CAMEL_KEY =
  /(jobId|providerId|contentHash|promptId|modelId|secret|token|credential|reasoning|evidenceIds|photoRequirement)/i

export function redactInternalReviewText(value: string): string {
  return value
    .replace(/\b[a-f0-9]{64}\b/gi, '[redacted digest]')
    .replace(
      /\b(job|provider|model)(?:[_ -]?id)?\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]'
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeUrlValue(value: unknown): unknown {
  if (typeof value !== 'string') return sanitizeValue(value)
  const trimmed = value.trim()
  if (!/^(https:\/\/|\/(?!\/))/i.test(trimmed)) return ''
  try {
    const relative = trimmed.startsWith('/')
    const url = new URL(trimmed, 'https://client-review.invalid')
    for (const key of [...url.searchParams.keys()]) {
      if (
        /(token|secret|signature|credential|hash|digest|job|provider|model|key)/i.test(
          key
        )
      ) {
        url.searchParams.delete(key)
      }
    }
    const safe = `${url.pathname}${url.search}`
    return relative ? safe : `${url.origin}${safe}`
  } catch {
    return ''
  }
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return null
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'string') return redactInternalReviewText(value)
  if (Array.isArray(value)) {
    return value.slice(0, 500).map(item => sanitizeValue(item, depth + 1))
  }
  if (!isRecord(value)) return null

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !SENSITIVE_KEY.test(key) &&
          !SENSITIVE_CAMEL_KEY.test(key) &&
          key !== 'purpose' &&
          key !== 'fields'
      )
      .slice(0, 500)
      .map(([key, item]) => [
        key,
        /(^|_)(url|href|link)$/i.test(key) ||
        /(Url|Href|Link)$/.test(key)
          ? sanitizeUrlValue(item)
          : sanitizeValue(item, depth + 1),
      ])
  )
}

export function sanitizeClientSafeRecord(
  value: unknown
): Record<string, unknown> {
  return isRecord(value)
    ? (sanitizeValue(value) as Record<string, unknown>)
    : {}
}

function safeText(value: unknown, fallback: string, maxLength = 500): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback
}

function safeSection(
  value: unknown,
  pageSlug: string,
  index: number
): ClientSafePage['sections'][number] | null {
  if (!isRecord(value)) return null
  const acfBlock = safeText(value.acfBlock, '')
  if (!acfBlock) return null
  const id = safeText(value.id, `${pageSlug}-section-${index + 1}`, 160)
  const cssClasses = Array.isArray(value.cssClasses)
    ? value.cssClasses
        .filter((item): item is string => typeof item === 'string')
        .filter(item => /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/.test(item))
        .slice(0, 20)
    : undefined

  return {
    id,
    type: safeText(value.type, 'section', 120),
    acfBlock,
    label:
      typeof value.label === 'string'
        ? value.label.trim().slice(0, 160)
        : undefined,
    variant:
      typeof value.variant === 'string'
        ? value.variant.trim().slice(0, 120)
        : undefined,
    cssClasses,
    content: isRecord(value.content)
      ? (sanitizeValue(value.content) as Record<string, unknown>)
      : {},
  }
}

export function buildClientSafePreview(blueprint: unknown): ClientSafePreview {
  const source = isRecord(blueprint) ? blueprint : {}
  const pages = Array.isArray(source.pages)
    ? source.pages.slice(0, 100).flatMap((page, pageIndex) => {
        if (!isRecord(page)) return []
        const slug = safeText(page.slug, `page-${pageIndex + 1}`, 180)
          .replace(/^\/+|\/+$/g, '')
          .replace(/[^a-zA-Z0-9/_-]/g, '-')
        const sections = Array.isArray(page.sections)
          ? page.sections.flatMap((section, sectionIndex) => {
              const safe = safeSection(section, slug, sectionIndex)
              return safe ? [safe] : []
            })
          : []
        return [
          {
            slug,
            title: safeText(page.title, `Page ${pageIndex + 1}`, 200),
            sections,
          },
        ]
      })
    : []

  const designSystemSource =
    (isRecord(source.designSystem) && source.designSystem) ||
    (isRecord(source.siteConfiguration) &&
      isRecord(source.siteConfiguration.design) &&
      source.siteConfiguration.design) ||
    null

  return {
    pages,
    designSystem: designSystemSource
      ? (sanitizeValue(designSystemSource) as Record<string, unknown>)
      : undefined,
  }
}

export function previewContainsScope(
  preview: ClientSafePreview,
  pagePath: string,
  sectionId?: string | null
): boolean {
  const slug = pagePath.replace(/^\/+|\/+$/g, '')
  const page = preview.pages.find(
    item =>
      item.slug === slug ||
      (!slug && ['home', 'index'].includes(item.slug.toLowerCase()))
  )
  if (!page) return false
  return !sectionId || page.sections.some(section => section.id === sectionId)
}

export function sanitizeSemanticOperations(
  value: unknown
): Array<{
  operation: string
  target: string
  summary?: string
  pagePath?: string
  sectionId?: string
}> {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap(item => {
    if (!isRecord(item)) return []
    const operation = safeText(item.operation, '', 120)
    const target = safeText(item.target, '', 500)
    if (!operation || !target) return []
    return [
      {
        operation: redactInternalReviewText(operation),
        target: redactInternalReviewText(target),
        summary:
          typeof item.summary === 'string'
            ? redactInternalReviewText(item.summary.trim().slice(0, 2_000))
            : undefined,
        pagePath:
          typeof item.pagePath === 'string'
            ? redactInternalReviewText(item.pagePath.trim().slice(0, 500))
            : undefined,
        sectionId:
          typeof item.sectionId === 'string'
            ? redactInternalReviewText(item.sectionId.trim().slice(0, 160))
            : undefined,
      },
    ]
  })
}
