const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'cite',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

const DROP_WITH_CONTENT_TAGS = new Set([
  'embed',
  'iframe',
  'math',
  'object',
  'script',
  'style',
  'svg',
  'template',
])

const VOID_TAGS = new Set(['br', 'hr'])
const GLOBAL_ATTRIBUTES = new Set(['class', 'title'])
const TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'rel', 'target']),
  blockquote: new Set(['cite']),
  li: new Set(['value']),
  ol: new Set(['reversed', 'start', 'type']),
  q: new Set(['cite']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
}
const URL_ATTRIBUTES = new Set(['cite', 'href'])

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function decodeCodePoint(code: string, radix: number): string {
  const value = Number.parseInt(code, radix)
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : ''
}

function decodeProtocolEntities(value: string): string {
  let decoded = value
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replace(/&#(\d+);?/g, (_, code: string) => decodeCodePoint(code, 10))
      .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) =>
        decodeCodePoint(code, 16)
      )
      .replace(/&(colon|tab|newline|amp);/gi, (_, entity: string) => {
        const replacements: Record<string, string> = {
          amp: '&',
          colon: ':',
          newline: '\n',
          tab: '\t',
        }
        return replacements[entity.toLowerCase()] || ''
      })
  }
  return decoded
}

function isSafeUrl(value: string): boolean {
  const normalized = decodeProtocolEntities(value)
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
    .toLowerCase()
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/)
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme[1])
}

function findTagEnd(html: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

function sanitizedAttributes(tag: string, source: string): string {
  const attributes = new Map<string, string>()
  const attributePattern =
    /([^\s=/>"'`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match: RegExpExecArray | null

  while ((match = attributePattern.exec(source))) {
    const name = match[1].toLowerCase()
    const allowed =
      GLOBAL_ATTRIBUTES.has(name) ||
      name === 'aria-label' ||
      TAG_ATTRIBUTES[tag]?.has(name)
    if (!allowed || name.startsWith('on')) continue

    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (URL_ATTRIBUTES.has(name) && !isSafeUrl(value)) continue
    if (name === 'target' && !['_blank', '_self'].includes(value.toLowerCase())) {
      continue
    }
    if (name === 'rel') {
      const rel = value
        .toLowerCase()
        .split(/\s+/)
        .filter(token =>
          ['nofollow', 'noopener', 'noreferrer', 'sponsored', 'ugc'].includes(token)
        )
      attributes.set(name, [...new Set(rel)].sort().join(' '))
      continue
    }
    attributes.set(name, value)
  }

  if (tag === 'a' && attributes.get('target')?.toLowerCase() === '_blank') {
    const rel = new Set((attributes.get('rel') || '').split(/\s+/).filter(Boolean))
    rel.add('noopener')
    rel.add('noreferrer')
    attributes.set('rel', [...rel].sort().join(' '))
  }

  return [...attributes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) =>
      value ? ` ${name}="${escapeAttribute(value)}"` : ` ${name}`
    )
    .join('')
}

/**
 * Deterministic, browser-safe subset of wp_kses_post for SiteForge previews.
 * Unknown wrappers are removed while their text remains; executable containers
 * and their contents are removed completely.
 */
export function sanitizeSiteForgePreviewHtml(html: string): string {
  let output = ''
  let cursor = 0

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor)
    if (tagStart === -1) {
      output += html.slice(cursor)
      break
    }
    output += html.slice(cursor, tagStart)

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4)
      cursor = commentEnd === -1 ? html.length : commentEnd + 3
      continue
    }

    const tagEnd = findTagEnd(html, tagStart)
    if (tagEnd === -1) {
      output += '&lt;'
      cursor = tagStart + 1
      continue
    }

    const token = html.slice(tagStart + 1, tagEnd)
    const parsed = token.match(/^\s*(\/?)\s*([a-z][a-z0-9-]*)\b([\s\S]*)$/i)
    if (!parsed) {
      cursor = tagEnd + 1
      continue
    }

    const closing = parsed[1] === '/'
    const tag = parsed[2].toLowerCase()
    if (!closing && DROP_WITH_CONTENT_TAGS.has(tag)) {
      const closingPattern = new RegExp(`<\\/\\s*${tag}\\s*>`, 'ig')
      closingPattern.lastIndex = tagEnd + 1
      const closingMatch = closingPattern.exec(html)
      cursor = closingMatch ? closingPattern.lastIndex : html.length
      continue
    }

    if (ALLOWED_TAGS.has(tag)) {
      if (closing) {
        if (!VOID_TAGS.has(tag)) output += `</${tag}>`
      } else {
        output += `<${tag}${sanitizedAttributes(tag, parsed[3])}>`
      }
    }
    cursor = tagEnd + 1
  }

  return output
}
