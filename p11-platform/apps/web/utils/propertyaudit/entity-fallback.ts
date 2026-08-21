export type FallbackEntity = {
  name: string
  domain: string
  rationale: string
  position: number
}

export type EntityFallbackContext = {
  brandName: string
  brandDomains?: string[]
  competitors?: string[]
  sourceText?: string
  expectedCity?: string
  analysisEntities?: Array<Partial<FallbackEntity> | null | undefined>
}

const GENERIC_WORDS = new Set(['apartments', 'apartment', 'properties', 'property', 'living', 'homes'])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findMentionIndex(text: string, name: string): number | null {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length < 2) return null
  const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'i')
  const match = pattern.exec(text)
  return match ? match.index : null
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || ''
}

function isBrandName(entityName: string, brandName: string): boolean {
  const name = entityName.toLowerCase()
  const brand = brandName.toLowerCase().trim()
  if (!brand) return false
  if (name.includes(brand)) return true
  const main = brand.split(/\s+/).filter(word => word.length > 3)[0]
  return Boolean(main && main.length >= 4 && !GENERIC_WORDS.has(main) && name.includes(main))
}

function isBrandDomain(domain: string, brandDomains: string[]): boolean {
  const normalized = normalizeDomain(domain)
  if (!normalized) return false
  return brandDomains.some(candidate => {
    const brand = normalizeDomain(candidate)
    return Boolean(brand) && (normalized === brand || normalized.endsWith(`.${brand}`))
  })
}

export function findTrackedBrandPosition(
  entities: Array<Pick<FallbackEntity, 'name' | 'domain' | 'position'>>,
  brandName: string,
  brandDomains: string[] = []
): number | null {
  for (const entity of entities) {
    if (brandDomains.length > 0 && isBrandDomain(entity.domain, brandDomains)) {
      return entity.position ?? null
    }
    if (isBrandName(entity.name, brandName)) {
      return entity.position ?? null
    }
  }
  return null
}

function normalizeEntities(
  entities?: Array<EntityLike | null | undefined>
): FallbackEntity[] {
  const seen = new Set<string>()
  const normalized: FallbackEntity[] = []
  for (const entity of entities || []) {
    const name = (entity?.name || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      name,
      domain: (entity?.domain || '').trim(),
      rationale: (entity?.rationale || 'Extracted from the answer text').trim(),
      position: typeof entity?.position === 'number' && entity.position > 0
        ? entity.position
        : normalized.length + 1,
    })
  }
  return normalized.sort((left, right) => left.position - right.position)
}

function knownNames(brandName: string, competitors: string[] = []): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const value of [brandName, ...competitors]) {
    const cleaned = (value || '').trim()
    if (!cleaned || cleaned.includes('.') || cleaned.length < 2) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(cleaned)
  }
  return names
}

function isUsableListName(name: string): boolean {
  const cleaned = name.trim()
  if (cleaned.length < 2 || cleaned.length > 70) return false
  if (!/[A-Za-z]/.test(cleaned)) return false
  return !/^(if you|these are|the following|note|source|http)/i.test(cleaned)
}

function extractListEntities(text: string, brandName: string, brandDomains: string[] = []): FallbackEntity[] {
  const entities: FallbackEntity[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\n/)) {
    const match = line.match(/^\s*(?:#{1,6}\s*)?(?:(\d+)[.)]\s+|[-*]\s+)(?:\*\*|__)?\s*(.+)$/)
    if (!match) continue
    const explicitPosition = match[1] ? Number.parseInt(match[1], 10) : null
    let raw = (match[2] || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|__|`/g, '')
    const name = raw.split(/\s*[—–|:]\s*/)[0].replace(/\s+-\s+.*$/, '').trim()
    if (!isUsableListName(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entities.push({
      name,
      domain: isBrandName(name, brandName) ? (brandDomains[0] || '') : '',
      rationale: 'Extracted from a numbered or bulleted recommendation list.',
      position: explicitPosition && explicitPosition > 0 ? explicitPosition : entities.length + 1,
    })
  }
  return entities.sort((left, right) => left.position - right.position)
}

function extractNamedEntitiesFromText(input: EntityFallbackContext & { text: string }): FallbackEntity[] {
  const hits = knownNames(input.brandName, input.competitors)
    .map(name => ({ name, index: findMentionIndex(input.text, name) }))
    .filter((item): item is { name: string; index: number } => item.index !== null)
    .sort((left, right) => left.index - right.index)

  return hits.map((hit, index) => ({
    name: hit.name,
    domain: isBrandName(hit.name, input.brandName) ? (input.brandDomains?.[0] || '') : '',
    rationale: `First mentioned in the answer at character ${hit.index + 1}.`,
    position: index + 1,
  }))
}

function isUnverifiedSoloBrand(entities: FallbackEntity[], brandName: string): boolean {
  return entities.length === 1
    && isBrandName(entities[0]?.name || '', brandName)
    && (entities[0]?.position || 0) === 1
}

function extractEntitiesFromText(input: EntityFallbackContext & { text: string }): FallbackEntity[] {
  const fromList = extractListEntities(input.text, input.brandName, input.brandDomains)
  if (fromList.length >= 2) return fromList
  const fromNames = extractNamedEntitiesFromText(input)
  return fromNames.length >= 2 ? fromNames : []
}

type EntityLike = {
  name?: string | null
  domain?: string | null
  rationale?: string | null
  position?: number | null
}

export function ensureOrderedEntities(input: {
  existing?: Array<EntityLike | null | undefined>
  analysisEntities?: Array<EntityLike | null | undefined>
  brandName: string
  brandDomains?: string[]
  competitors?: string[]
  text: string
}): FallbackEntity[] {
  const context = {
    brandName: input.brandName,
    brandDomains: input.brandDomains || [],
    competitors: input.competitors || [],
    text: input.text,
  }
  const existing = normalizeEntities(input.existing)
  if (existing.length > 0 && !isUnverifiedSoloBrand(existing, input.brandName)) {
    return existing
  }
  const fromAnalysis = normalizeEntities(input.analysisEntities)
  if (fromAnalysis.length > 0 && !isUnverifiedSoloBrand(fromAnalysis, input.brandName)) {
    return fromAnalysis
  }
  return extractEntitiesFromText(context)
}

export function reconcileHallucinationFlags(
  flags: string[],
  text: string,
  brandName: string
): string[] {
  if (findMentionIndex(text, brandName) == null) {
    return [...flags]
  }
  return flags.filter(flag => flag !== 'possible_hallucination')
}

export function finalizeAnswerBlock<T extends {
  ordered_entities?: Array<EntityLike | null | undefined>
  answer_summary?: string
  notes?: { flags?: string[] | null }
}>(
  answer: T,
  context: EntityFallbackContext
): T & { ordered_entities: FallbackEntity[]; notes: { flags: string[] } } {
  const text = [context.sourceText, answer.answer_summary].filter(Boolean).join('\n')
  const orderedEntities = ensureOrderedEntities({
    existing: answer.ordered_entities,
    analysisEntities: context.analysisEntities,
    brandName: context.brandName,
    brandDomains: context.brandDomains,
    competitors: context.competitors,
    text,
  })
  const flags = reconcileHallucinationFlags(answer.notes?.flags || [], text, context.brandName)
  return {
    ...answer,
    ordered_entities: orderedEntities,
    notes: {
      ...(answer.notes || {}),
      flags,
    },
  }
}
