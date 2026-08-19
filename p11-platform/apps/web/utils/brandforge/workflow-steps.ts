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
import type { Json } from '@/types/supabase'

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

export async function loadBrandForgeCompetitiveSnapshot(
  input: BrandForgeWorkflowInput
): Promise<CompetitivePositioningSnapshot> {
  'use step'
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

  const { data: updated, error } = await supabase
    .from('property_brand_assets')
    .update({
      section_1_introduction: toJson(sections.section_1_introduction),
      section_2_positioning: toJson(sections.section_2_positioning),
      section_3_target_audience: toJson(sections.section_3_target_audience),
      section_4_personas: toJson(sections.section_4_personas),
      section_5_name_story: toJson(sections.section_5_name_story),
      section_6_logo: toJson(sections.section_6_logo),
      section_7_typography: toJson(sections.section_7_typography),
      section_8_colors: toJson(sections.section_8_colors),
      section_9_design_elements: toJson(sections.section_9_design_elements),
      section_10_photo_yep: toJson(sections.section_10_photo_yep),
      section_11_photo_nope: toJson(sections.section_11_photo_nope),
      section_12_implementation: toJson(sections.section_12_implementation),
      generation_status: 'complete',
      current_step: 12,
      current_step_name: 'complete',
      draft_section: null,
      contract_version: contract.contractVersion,
      brand_origin: contract.origin,
      approval_status: 'approved',
      contract_hash: contractHash,
      competitor_ids: snapshot.evidence.map(item => item.competitorId),
      competitive_analysis: toJson(snapshot),
      source_manifest: toJson(sourceManifest),
      model_version: generation === 'model'
        ? process.env.BRANDFORGE_MODEL || 'anthropic/claude-sonnet-5'
        : generation,
    })
    .eq('id', workflow.brandAssetId)
    .eq('property_id', workflow.propertyId)
    .select('id')
    .single()

  if (error || !updated) {
    throw new Error(`Unable to persist BrandForge contract: ${error?.message || 'asset not found'}`)
  }

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
  const supabase = createAdminClient()
  await supabase
    .from('property_brand_assets')
    .update({
      generation_status: 'failed',
      draft_section: null,
      source_manifest: {
        workflow: {
          mode: input.mode,
          vertical: input.vertical,
          requestedBy: input.requestedBy,
          failure: message,
        },
      },
    })
    .eq('id', input.brandAssetId)
    .eq('property_id', input.propertyId)
}
