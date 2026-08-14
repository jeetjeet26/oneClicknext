import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { normalizeBrandAssetRow } from '@/utils/brandforge/normalize'
import { hashBrandForgeContract } from '@/utils/brandforge/normalize'
import {
  deriveSiteForgeDirectionPreview,
  hashSiteForgeDirection,
  hashSiteForgeDirectionSet,
  siteForgeCreativeDirectionSchema,
  type SiteForgeDirectionCandidate,
} from './contracts'
import {
  getSiteForgeDirectionSet,
  SiteForgeDirectionError,
} from './repository'
import {
  runSiteForgeDirectionEditorAgent,
  type SiteForgeDirectionEditorAgentInput,
} from './editor-agent'

type ServiceClient = SupabaseClient<Database>
type AgentRunner = typeof runSiteForgeDirectionEditorAgent

function approvedBrandValues(row: Record<string, unknown>) {
  const contract = normalizeBrandAssetRow(row)
  return {
    contract,
    palette: contract.colors.roles.map(color => color.hex.toUpperCase()),
    fonts: contract.typography.roles.map(font => font.family),
  }
}

function validateBrandBoundDirection(
  direction: ReturnType<typeof siteForgeCreativeDirectionSchema.parse>,
  palette: string[],
  fonts: string[]
) {
  const approvedColors = new Set(palette.map(color => color.toUpperCase()))
  const colors = Object.values(direction.palette).map(color => color.toUpperCase())
  if (colors.some(color => !approvedColors.has(color))) {
    throw new SiteForgeDirectionError(
      'The requested palette is not approved by the pinned BrandForge contract',
      422
    )
  }
  const approvedFonts = new Set(fonts)
  if (
    !approvedFonts.has(direction.typography.headingFamily) ||
    !approvedFonts.has(direction.typography.bodyFamily)
  ) {
    throw new SiteForgeDirectionError(
      'The requested typography is not approved by the pinned BrandForge contract',
      422
    )
  }
}

export async function editSiteForgeCreativeDirection(
  input: {
    directionSetId: string
    propertyId: string
    selectedDirectionId: string
    expectedSetContentHash: string
    expectedDirectionContentHash: string
    clientRequestId: string
    instruction: string
    actorId: string
  },
  client: ServiceClient,
  runAgent: AgentRunner = runSiteForgeDirectionEditorAgent
) {
  const current = await getSiteForgeDirectionSet(
    input.directionSetId,
    input.propertyId,
    client
  )
  if (
    current.contentHash !== input.expectedSetContentHash ||
    current.selectedDirectionId !== input.selectedDirectionId
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction changed; reload before editing',
      409
    )
  }
  const selected = current.directions.find(
    direction => direction.id === input.selectedDirectionId
  )
  if (
    !selected ||
    selected.contentHash !== input.expectedDirectionContentHash
  ) {
    throw new SiteForgeDirectionError(
      'Selected creative direction changed; reload before editing',
      409
    )
  }
  const dedupeKey = `siteforge-direction-edit:${current.id}:${input.clientRequestId}`
  const { data: duplicateJob } = await client
    .from('shared_jobs')
    .select('payload')
    .eq('org_id', current.orgId)
    .eq('domain', 'siteforge.direction.edit')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  const duplicatePayload =
    duplicateJob?.payload &&
    typeof duplicateJob.payload === 'object' &&
    !Array.isArray(duplicateJob.payload)
      ? duplicateJob.payload
      : null
  const duplicateSetId =
    duplicatePayload &&
    typeof duplicatePayload.resultSetId === 'string'
      ? duplicatePayload.resultSetId
      : null
  if (duplicateSetId) {
    return {
      outcome: {
        outcome: 'patch' as const,
        summary: 'That creative direction edit was already applied.',
        patch: { rationale: selected.direction.rationale },
      },
      duplicate: true,
      directionSet: await getSiteForgeDirectionSet(
        duplicateSetId,
        current.propertyId,
        client
      ),
    }
  }
  const provenance = selected.direction.provenance
  const { data: brand, error: brandError } = await client
    .from('property_brand_assets')
    .select('*')
    .eq('id', provenance.brandAssetId)
    .eq('property_id', current.propertyId)
    .eq('approval_status', 'approved')
    .single()
  if (brandError || !brand) {
    throw new SiteForgeDirectionError(
      'Pinned BrandForge contract is unavailable',
      409
    )
  }
  const approved = approvedBrandValues(brand as unknown as Record<string, unknown>)
  if (hashBrandForgeContract(approved.contract) !== provenance.brandContractHash) {
    throw new SiteForgeDirectionError(
      'Pinned BrandForge contract changed; prepare a current recommendation',
      409
    )
  }

  let agentResult: Awaited<ReturnType<AgentRunner>>
  try {
    agentResult = await runAgent({
      instruction: input.instruction,
      direction: selected.direction,
      approvedPalette: approved.palette,
      approvedFonts: approved.fonts,
    } satisfies SiteForgeDirectionEditorAgentInput)
  } catch {
    throw new SiteForgeDirectionError(
      'The creative editor is temporarily unavailable. No direction was changed.',
      503
    )
  }
  if (agentResult.outcome.outcome !== 'patch') {
    return {
      outcome: agentResult.outcome,
      duplicate: false,
      directionSet: current,
    }
  }

  const direction = siteForgeCreativeDirectionSchema.parse({
    ...selected.direction,
    ...agentResult.outcome.patch,
    provenance,
  })
  validateBrandBoundDirection(direction, approved.palette, approved.fonts)
  const previewManifest = deriveSiteForgeDirectionPreview(direction)
  const revisedCandidate: SiteForgeDirectionCandidate = {
    ordinal: selected.ordinal,
    name: selected.name,
    direction,
    previewManifest,
    contentHash: hashSiteForgeDirection({
      ordinal: selected.ordinal,
      name: selected.name,
      direction,
      previewManifest,
    }),
  }
  if (revisedCandidate.contentHash === selected.contentHash) {
    throw new SiteForgeDirectionError(
      'The requested edit would not change this creative direction',
      422
    )
  }
  const candidates = current.directions.map(directionCandidate =>
    directionCandidate.id === selected.id ? revisedCandidate : directionCandidate
  )
  const resultHash = hashSiteForgeDirectionSet({
    briefVersionId: current.briefVersionId,
    briefContentHash: provenance.briefContentHash,
    directionHashes: candidates.map(candidate => candidate.contentHash),
    selectedDirectionHash: revisedCandidate.contentHash,
    selectionNotes: current.selectionNotes,
  })
  const { data, error } = await client.rpc(
    'apply_siteforge_direction_edit',
    {
      p_parent_set_id: current.id,
      p_property_id: current.propertyId,
      p_expected_set_hash: current.contentHash,
      p_expected_direction_hash: selected.contentHash,
      p_selected_ordinal: selected.ordinal,
      p_candidates: candidates.map(candidate => ({
        ordinal: candidate.ordinal,
        name: candidate.name,
        direction: candidate.direction,
        previewManifest: candidate.previewManifest,
        contentHash: candidate.contentHash,
      })) as unknown as Json,
      p_result_set_hash: resultHash,
      p_client_request_id: input.clientRequestId,
      p_model: agentResult.model,
      p_request_summary: input.instruction,
      p_tool_summary: agentResult.toolSummary,
      p_actor_id: input.actorId,
    }
  )
  const row = data?.[0]
  if (error || !row) {
    const stale = /changed|stale|hash/i.test(error?.message || '')
    throw new SiteForgeDirectionError(
      stale
        ? 'Creative direction changed; reload before editing'
        : 'The creative edit could not be saved. No direction was changed.',
      stale ? 409 : 500
    )
  }
  return {
    outcome: agentResult.outcome,
    duplicate: row.version === current.version,
    directionSet: await getSiteForgeDirectionSet(
      row.id,
      current.propertyId,
      client
    ),
  }
}

export async function selectSiteForgeCreativeDirectionAlternative(
  input: {
    directionSetId: string
    propertyId: string
    selectedDirectionId: string
    alternativeDirectionId: string
    expectedSetContentHash: string
    expectedDirectionContentHash: string
    clientRequestId: string
    actorId: string
  },
  client: ServiceClient
) {
  const current = await getSiteForgeDirectionSet(
    input.directionSetId,
    input.propertyId,
    client
  )
  const selected = current.directions.find(
    direction => direction.id === input.selectedDirectionId
  )
  const alternative = current.directions.find(
    direction => direction.id === input.alternativeDirectionId
  )
  if (
    current.contentHash !== input.expectedSetContentHash ||
    current.selectedDirectionId !== input.selectedDirectionId ||
    !selected ||
    selected.contentHash !== input.expectedDirectionContentHash
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction changed; reload before selecting an alternative',
      409
    )
  }
  if (!alternative || alternative.id === selected.id) {
    throw new SiteForgeDirectionError(
      'Choose a different creative direction from this recommendation',
      400
    )
  }
  const resultHash = hashSiteForgeDirectionSet({
    briefVersionId: current.briefVersionId,
    briefContentHash: selected.direction.provenance.briefContentHash,
    directionHashes: current.directions.map(candidate => candidate.contentHash),
    selectedDirectionHash: alternative.contentHash,
    selectionNotes: `Selected alternative: ${alternative.name}`,
  })
  const { data, error } = await client.rpc('apply_siteforge_direction_edit', {
    p_parent_set_id: current.id,
    p_property_id: current.propertyId,
    p_expected_set_hash: current.contentHash,
    p_expected_direction_hash: selected.contentHash,
    p_selected_ordinal: alternative.ordinal,
    p_candidates: current.directions.map(candidate => ({
      ordinal: candidate.ordinal,
      name: candidate.name,
      direction: candidate.direction,
      previewManifest: candidate.previewManifest,
      contentHash: candidate.contentHash,
    })) as unknown as Json,
    p_result_set_hash: resultHash,
    p_client_request_id: input.clientRequestId,
    p_model: 'deterministic-alternative-selection-v1',
    p_request_summary: `Use the existing alternative direction: ${alternative.name}`,
    p_tool_summary: 'Selected an existing source-pinned direction without model edits.',
    p_actor_id: input.actorId,
  })
  const row = data?.[0]
  if (error || !row) {
    const stale = /changed|stale|hash/i.test(error?.message || '')
    throw new SiteForgeDirectionError(
      stale
        ? 'Creative direction changed; reload before selecting an alternative'
        : 'The alternative direction could not be selected.',
      stale ? 409 : 500
    )
  }
  return {
    outcome: {
      outcome: 'patch' as const,
      summary: `Selected ${alternative.name}.`,
      patch: { rationale: alternative.direction.rationale },
    },
    duplicate: row.version === current.version,
    directionSet: await getSiteForgeDirectionSet(
      row.id,
      current.propertyId,
      client
    ),
  }
}
