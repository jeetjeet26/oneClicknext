import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type ServiceClient = SupabaseClient<Database>

const FETCH_TIMEOUT_MS = 15_000
const MAX_OUTLINE_LINES = 400
const MAX_CHILDREN_PER_NODE = 12
const MAX_DEPTH = 8
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'iframe'])

export interface RenderedPageDom {
  url: string
  html: string
}

/**
 * Resolve the live canonical preview URL for a website. The rendered preview
 * is the exact ground truth the operator sees; overlay CSS must be written
 * against this DOM, never against guessed markup.
 */
export async function resolveCanonicalPreviewUrl(
  websiteId: string,
  client: ServiceClient
): Promise<string | null> {
  const { data: website } = await client
    .from('property_websites')
    .select('canonical_preview_url')
    .eq('id', websiteId)
    .maybeSingle()
  if (website?.canonical_preview_url) return website.canonical_preview_url
  const { data: target } = await client
    .from('siteforge_wordpress_targets')
    .select('site_url')
    .eq('website_id', websiteId)
    .eq('target_type', 'canonical_preview')
    .eq('is_active', true)
    .maybeSingle()
  return target?.site_url || null
}

/** Fetch the rendered HTML of one page from the canonical preview instance. */
export async function fetchRenderedPageDom(input: {
  websiteId: string
  pageSlug: string
  client: ServiceClient
}): Promise<RenderedPageDom | { error: string }> {
  const baseUrl = await resolveCanonicalPreviewUrl(input.websiteId, input.client)
  if (!baseUrl) {
    return {
      error:
        'No canonical preview exists for this website yet, so the rendered DOM cannot be inspected.',
    }
  }
  const slug = input.pageSlug.replace(/^\/+|\/+$/g, '').toLowerCase()
  const url =
    !slug || slug === 'home'
      ? `${baseUrl.replace(/\/$/, '')}/`
      : `${baseUrl.replace(/\/$/, '')}/${slug}/`
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'SiteForge-Editor-DomInspector/1.0' },
    })
    if (!response.ok) {
      return { error: `Rendered page fetch failed (${response.status}) for ${url}` }
    }
    return { url, html: await response.text() }
  } catch (cause) {
    return {
      error: `Rendered page fetch failed for ${url}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    }
  }
}

function describeElement($: cheerio.CheerioAPI, element: Element): string {
  const tag = element.tagName?.toLowerCase() || 'node'
  const attribs = element.attribs || {}
  const id = attribs.id ? `#${attribs.id}` : ''
  const classes = (attribs.class || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map(name => `.${name}`)
    .join('')
  const dataAttrs = Object.entries(attribs)
    .filter(([name]) => name.startsWith('data-siteforge'))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')
  const ownText = $(element)
    .contents()
    .filter((_, node) => node.type === 'text')
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `<${tag}${id}${classes}${dataAttrs}>${ownText ? ` “${ownText}”` : ''}`
}

/**
 * Build a compact structural outline of the rendered page so the editor agent
 * writes overlay selectors against real markup. When `sectionId` is provided,
 * the outline is scoped to that section's subtree.
 */
export function buildRenderedDomOutline(
  html: string,
  options?: { sectionId?: string }
): string {
  const $ = cheerio.load(html)
  const lines: string[] = []
  let truncated = false

  const walk = (element: Element, depth: number) => {
    if (lines.length >= MAX_OUTLINE_LINES) {
      truncated = true
      return
    }
    const tag = element.tagName?.toLowerCase() || ''
    if (SKIPPED_TAGS.has(tag)) return
    lines.push(`${'  '.repeat(depth)}${describeElement($, element)}`)
    if (depth >= MAX_DEPTH) return
    const children = $(element).children().toArray()
    for (const child of children.slice(0, MAX_CHILDREN_PER_NODE)) {
      walk(child, depth + 1)
    }
    if (children.length > MAX_CHILDREN_PER_NODE) {
      lines.push(
        `${'  '.repeat(depth + 1)}… ${children.length - MAX_CHILDREN_PER_NODE} more sibling(s)`
      )
    }
  }

  const roots = options?.sectionId
    ? $(`[data-siteforge-section-id="${options.sectionId}"]`).toArray()
    : $('[data-siteforge-section-id]').toArray()
  if (roots.length === 0) {
    const body = $('main').first().toArray()[0] || $('body').first().toArray()[0]
    if (body) walk(body, 0)
  } else {
    for (const root of roots) walk(root, 0)
  }
  if (truncated) lines.push('… outline truncated')
  return lines.join('\n')
}

/**
 * Extract the flat list of CSS selectors from a stylesheet, unwrapping
 * grouping at-rules (@media, @supports, @layer) and skipping non-selector
 * at-rules (@font-face, @keyframes, @import, ...).
 */
export function extractCssSelectors(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors: string[] = []

  const parseBlock = (block: string): void => {
    let prelude = ''
    let index = 0
    while (index < block.length) {
      const char = block[index]
      if (char === '{') {
        const body = readBalancedBlock(block, index)
        const trimmed = prelude.trim()
        if (trimmed.startsWith('@')) {
          if (/^@(media|supports|layer|container|scope)\b/.test(trimmed)) {
            parseBlock(body.content)
          }
        } else if (trimmed) {
          for (const part of trimmed.split(',')) {
            const selector = part.trim()
            if (selector) selectors.push(selector)
          }
        }
        prelude = ''
        index = body.end + 1
        continue
      }
      if (char === ';') {
        prelude = ''
        index += 1
        continue
      }
      prelude += char
      index += 1
    }
  }

  const readBalancedBlock = (
    text: string,
    openBraceIndex: number
  ): { content: string; end: number } => {
    let depth = 0
    for (let i = openBraceIndex; i < text.length; i++) {
      if (text[i] === '{') depth += 1
      if (text[i] === '}') {
        depth -= 1
        if (depth === 0) {
          return { content: text.slice(openBraceIndex + 1, i), end: i }
        }
      }
    }
    return { content: text.slice(openBraceIndex + 1), end: text.length }
  }

  parseBlock(source)
  return selectors
}

/** Strip pseudo-classes/elements so structural matching can run server-side. */
function stripPseudo(selector: string): string {
  return selector
    .replace(/::?[a-zA-Z-]+(\((?:[^()]|\([^()]*\))*\))?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Return the selectors in `css` that match zero elements in the rendered
 * page. Dead selectors are the signature failure mode of overlay CSS written
 * against guessed markup; a proposal containing any must be rejected.
 * Selectors that cannot be evaluated server-side are skipped (never reported
 * as dead), so this check cannot false-positive on exotic-but-valid CSS.
 */
export function findDeadCssSelectors(html: string, css: string): string[] {
  const $ = cheerio.load(html)
  const dead: string[] = []
  for (const selector of extractCssSelectors(css)) {
    const structural = stripPseudo(selector)
    if (!structural || /[>+~]\s*$/.test(structural)) continue
    try {
      if ($(structural).length === 0) dead.push(selector)
    } catch {
      // Selector syntax the server-side engine cannot evaluate: skip.
    }
  }
  return dead
}
