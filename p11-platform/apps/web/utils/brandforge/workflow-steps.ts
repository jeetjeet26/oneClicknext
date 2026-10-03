import { brandRpc } from './operations'
import { BRAND_SECTION_COLUMNS } from './contracts'
import { createAdminClient } from '@/utils/supabase/admin'
import {
  type BrandForgeContractV1,
  type BrandForgeWorkflowInput,
  type CompetitivePositioningSnapshot,
} from './contracts'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
} from './normalize'
import { convergeBrandForgeContract } from './autonomous-service'
import { loadCompetitivePositioningSnapshot } from '@/utils/marketvision/brandforge-competitive-snapshot'

export async function loadBrandForgeCompetitiveSnapshot(
  input: BrandForgeWorkflowInput
): Promise<CompetitivePositioningSnapshot> {
  'use step'
  if (!input.operationId || !input.operationToken) throw new Error('Brand workflow is missing its saved request')
  await ensureBrandRequestActive(input)
  console.info('[brandforge_workflow] loading competitive snapshot', {
    brandAssetId: input.brandAssetId,
    propertyId: input.propertyId,
    mode: input.mode,
  })
  return loadCompetitivePositioningSnapshot({
    propertyId: input.propertyId,
    vertical: input.vertical,
  })
}

export async function convergeBrandForgeWorkflowContract(
  input: BrandForgeWorkflowInput,
  snapshot: CompetitivePositioningSnapshot
) {
  'use step'
  await ensureBrandRequestActive(input)
  console.info('[brandforge_workflow] converging contract', {
    brandAssetId: input.brandAssetId,
    mode: input.mode,
    snapshotCausalHash: snapshot.causalHash,
  })
  return convergeBrandForgeContract(input, snapshot)
}

export async function persistBrandForgeWorkflowContract(input: {
  workflow: BrandForgeWorkflowInput
  snapshot: CompetitivePositioningSnapshot
  contract: BrandForgeContractV1
  generation: 'model' | 'deterministic' | 'supplied'
}) {
  'use step'
  const { workflow, snapshot, contract, generation } = input
  const supabase = createAdminClient()
  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('id, org_id')
    .eq('id', workflow.propertyId)
    .eq('org_id', workflow.orgId)
    .single()

  if (propertyError || !property) {
    throw new Error('BrandForge workflow tenant context no longer matches the property')
  }

  const contractHash = hashBrandForgeContract(contract)
  const sourceManifest = {
    workflow: {
      mode: workflow.mode,
      vertical: workflow.vertical,
      requestedBy: workflow.requestedBy,
      generation,
      modelVersion: generation === 'model' ? process.env.BRANDFORGE_MODEL || 'anthropic/claude-sonnet-5' : generation,
    },
    competitiveSnapshot: {
      schemaVersion: snapshot.schemaVersion,
      sourceHash: snapshot.sourceHash,
      causalHash: snapshot.causalHash,
      generatedAt: snapshot.generatedAt,
      evidence: snapshot.evidence.map(item => item.source),
    },
  }
  const sections = brandContractToStorageSections(contract)

  if (!workflow.operationId || !workflow.operationToken) throw new Error('Brand workflow is missing its saved request')
  const draftSections = Object.fromEntries(Object.entries(sections).map(([key, value]) => {
    const section = value as Record<string, unknown>
    const meta = (section._meta || {}) as Record<string, unknown>
    return [key, { ...section, status: 'reviewing', approved_by: null, approved_at: null, _meta: { ...meta, approval: { status: 'reviewing' } } }]
  }))
  const persisted = await brandRpc('finish_brand_operation', {
    p_request_id: workflow.operationId, p_claim_token: workflow.operationToken,
    p_updates: {
      ...Object.fromEntries(BRAND_SECTION_COLUMNS.map(column => [column, null])),
      proposed_sections: draftSections,
      generation_status: 'reviewing', current_step: 1, current_step_name: 'introduction',
      draft_section: { step: 1, name: 'introduction', data: draftSections.section_1_introduction, version: 1 },
      contract_version: contract.contractVersion, brand_origin: contract.origin,
      approval_status: 'reviewing', approved_by: null, approved_at: null, contract_hash: contractHash,
      competitive_analysis: snapshot,
      source_manifest: sourceManifest,
    },
    p_result: { contractHash, snapshotCausalHash: snapshot.causalHash, generation, readyForReview: true },
  })
  if (!['applied','replayed'].includes(String(persisted.state))) throw new Error('Brand generation no longer matches the saved request')

  console.info('[brandforge_workflow] contract persisted', {
    brandAssetId: workflow.brandAssetId,
    contractHash,
    snapshotCausalHash: snapshot.causalHash,
  })
  return {
    brandAssetId: workflow.brandAssetId,
    contractHash,
    snapshotCausalHash: snapshot.causalHash,
    generation,
  }
}

export async function failBrandForgeWorkflow(
  input: BrandForgeWorkflowInput,
  error: unknown
) {
  'use step'
  const message = error instanceof Error ? error.message : String(error)
  console.error('[brandforge_workflow] run failed', {
    brandAssetId: input.brandAssetId,
    message,
  })
  if (!input.operationId || !input.operationToken) return
  await brandRpc('finish_brand_operation', { p_request_id: input.operationId, p_claim_token: input.operationToken, p_updates: {}, p_result: {}, p_error: 'generation_failed' })
}

async function ensureBrandRequestActive(input: BrandForgeWorkflowInput) {
 if (!input.operationId || !input.operationToken) throw new Error('Brand workflow is missing its saved request')
 const current = await brandRpc('check_brand_operation', { p_request_id: input.operationId, p_claim_token: input.operationToken })
 if (current.state !== 'active') throw new Error('Brand request is no longer active')
}
