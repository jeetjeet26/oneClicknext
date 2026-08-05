export type KnowledgeSourceRecord = {
  id: string
  source_type: string
  source_name: string
  source_url?: string | null
  file_name?: string | null
  file_type?: string | null
  status: string
  documents_created?: number | null
  extracted_data?: Record<string, unknown> | null
  processing_notes?: string | null
  last_synced_at?: string | null
  error_message?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type SourceOrigin = 'generated' | 'uploaded'

export type SourceIdentity = {
  label: string
  value: string
}

export type KnowledgeSourcePresentation = {
  origin: SourceOrigin | null
  sourceTypeLabel: string
  sourceUrlHref: string | null
  lastSuccessfulAt: string | null
  lastAttemptAt: string | null
  ingestionVersion: string | null
  documentCount: number | null
  identities: SourceIdentity[]
}

export type ChatbotContextRecord = {
  id?: string | null
  status: string
  requires_review: boolean
  context_markdown?: string | null
  source_ids?: unknown
  source_snapshot?: unknown
  version?: number | null
  stale_at?: string | null
}

export type ChatbotContextPresentation = {
  lifecycleLabel: string
  reviewLabel: string
  sourceIds: string[]
  documentCount: number | null
  hasGeneratedContext: boolean
  availabilityExplanation: string | null
  identity: string | null
}

export type ChatbotContextRevisionRecord = {
  id: string
  changed_source_ids?: unknown
  removed_source_ids?: unknown
  model?: string | null
}

const GENERATED_SOURCE_TYPES = new Set(['brand_book', 'intake_form', 'website'])
const UPLOADED_SOURCE_TYPES = new Set(['document', 'manual'])

const SOURCE_TYPE_LABELS: Record<string, string> = {
  intake_form: 'Intake Form',
  document: 'Document',
  website: 'Website Extraction',
  integration: 'Integration',
  manual: 'Manual Entry',
  brand_book: 'BrandForge Brand Book',
  competitor_intelligence: 'Competitor Intelligence',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    const current = asRecord(value)
    return current ? current[key] : undefined
  }, record)
}

function readText(record: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = readPath(record, path)
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function readCount(record: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    const value = readPath(record, path)
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  }
  return null
}

function readTimestamp(record: Record<string, unknown>, paths: string[]): string | null {
  const value = readText(record, paths)
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}

function safeExternalHref(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function isSiteForgeArtifact(metadata: Record<string, unknown>): boolean {
  if (readText(metadata, ['siteforge_artifact_id', 'siteforge.artifact_id', 'siteforge.artifactId'])) {
    return true
  }

  const marker = readText(metadata, [
    'source_type',
    'source_origin',
    'origin',
    'generated_by',
    'generator',
    'provenance.source',
    'provenance.origin',
  ])?.toLowerCase()
  const artifactId = readText(metadata, [
    'artifact_id',
    'artifact_version_id',
    'artifact.id',
    'artifact.version_id',
    'provenance.artifact_id',
  ])

  return Boolean(marker?.includes('siteforge') && (marker.includes('artifact') || artifactId))
}

export function classifyKnowledgeSource(source: KnowledgeSourceRecord): SourceOrigin | null {
  const metadata = asRecord(source.extracted_data) ?? {}
  if (isSiteForgeArtifact(metadata)) return 'generated'
  if (GENERATED_SOURCE_TYPES.has(source.source_type)) return 'generated'
  if (UPLOADED_SOURCE_TYPES.has(source.source_type)) return 'uploaded'
  return null
}

export function getSourceTypeLabel(sourceType: string): string {
  if (SOURCE_TYPE_LABELS[sourceType]) return SOURCE_TYPE_LABELS[sourceType]
  const normalized = sourceType.replace(/[_-]+/g, ' ').trim()
  return normalized
    ? normalized.replace(/\b\w/g, character => character.toUpperCase())
    : 'Other Source'
}

export function presentKnowledgeSource(source: KnowledgeSourceRecord): KnowledgeSourcePresentation {
  const metadata = asRecord(source.extracted_data) ?? {}
  const explicitSuccess = readTimestamp(metadata, [
    'last_successful_at',
    'last_succeeded_at',
    'ingestion.last_successful_at',
    'provenance.last_successful_at',
  ])
  const lastAttemptAt = readTimestamp(metadata, [
    'last_attempt_at',
    'attempted_at',
    'last_ingestion_attempt_at',
    'ingestion.last_attempt_at',
    'provenance.last_attempt_at',
  ])
  const ingestionVersion = readText(metadata, [
    'ingestion_version',
    'ingestionVersion',
    'ingestion.version',
    'provenance.ingestion_version',
  ])

  const identities: SourceIdentity[] = []
  const identityCandidates: Array<[string, string[]]> = [
    ['Provenance', ['provenance_identity', 'provenance.identity', 'source_identity']],
    ['SiteForge artifact', ['siteforge_artifact_id', 'siteforge.artifact_id', 'siteforge.artifactId']],
    ['Artifact', ['artifact_id', 'artifact.id']],
    ['Brand asset', ['brand_asset_id']],
    ['Ingestion run', ['ingestion_run_id']],
    ['Crawl run', ['crawl_run_id']],
  ]
  const seenIdentities = new Set<string>()

  for (const [label, paths] of identityCandidates) {
    const value = readText(metadata, paths)
    if (!value || seenIdentities.has(value)) continue
    seenIdentities.add(value)
    identities.push({ label, value })
  }

  const documentCount = typeof source.documents_created === 'number' && source.documents_created >= 0
    ? source.documents_created
    : readCount(metadata, ['document_count', 'documents_created', 'embedded_chunks', 'total_chunks'])

  return {
    origin: classifyKnowledgeSource(source),
    sourceTypeLabel: getSourceTypeLabel(source.source_type),
    sourceUrlHref: safeExternalHref(source.source_url),
    lastSuccessfulAt: explicitSuccess ?? normalizeTimestamp(source.last_synced_at),
    lastAttemptAt: lastAttemptAt === explicitSuccess || lastAttemptAt === normalizeTimestamp(source.last_synced_at)
      ? null
      : lastAttemptAt,
    ingestionVersion,
    documentCount,
    identities,
  }
}

export function presentChatbotContext(context: ChatbotContextRecord | null): ChatbotContextPresentation {
  if (!context) {
    return {
      lifecycleLabel: 'Not generated',
      reviewLabel: 'No context to review',
      sourceIds: [],
      documentCount: null,
      hasGeneratedContext: false,
      availabilityExplanation: null,
      identity: null,
    }
  }

  const sourceIds = readStringArray(context.source_ids)
  const snapshot = asRecord(context.source_snapshot)
  const documentCount = snapshot ? readCount(snapshot, ['document_count']) : null
  const hasGeneratedContext = Boolean(context.context_markdown?.trim())
  let availabilityExplanation: string | null = null

  if (hasGeneratedContext && documentCount === 0) {
    availabilityExplanation = 'Generated context exists even though no uploaded document chunks are included. Property setup and generated sources can still provide context.'
  } else if (hasGeneratedContext && sourceIds.length > 0) {
    availabilityExplanation = 'Generated context exists and records the tracked knowledge source IDs shown below.'
  } else if (hasGeneratedContext) {
    availabilityExplanation = 'Generated context exists from property setup.'
  }

  const isStale = context.status === 'stale'
  const lifecycleLabel = isStale
    ? 'Stale'
    : context.status === 'current'
      ? 'Current'
      : context.status === 'needs_review'
        ? 'Needs review'
        : getSourceTypeLabel(context.status)

  return {
    lifecycleLabel,
    reviewLabel: context.requires_review || context.status === 'needs_review'
      ? 'Review required'
      : 'No review pending',
    sourceIds,
    documentCount,
    hasGeneratedContext,
    availabilityExplanation,
    identity: context.id
      ? `${context.id}${typeof context.version === 'number' ? ` · version ${context.version}` : ''}`
      : typeof context.version === 'number'
        ? `Version ${context.version}`
        : null,
  }
}

export function presentRevisionIdentity(revision: ChatbotContextRevisionRecord): {
  id: string
  changedSourceIds: string[]
  removedSourceIds: string[]
  model: string | null
} {
  return {
    id: revision.id,
    changedSourceIds: readStringArray(revision.changed_source_ids),
    removedSourceIds: readStringArray(revision.removed_source_ids),
    model: typeof revision.model === 'string' && revision.model.trim() ? revision.model : null,
  }
}
