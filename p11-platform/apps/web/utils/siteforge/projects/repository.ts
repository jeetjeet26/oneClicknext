import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'

type ServiceClient = SupabaseClient<Database>
type WebsiteRow = Pick<
  Tables<'property_websites'>,
  | 'id'
  | 'org_id'
  | 'property_id'
  | 'generation_status'
  | 'generation_progress'
  | 'current_step'
  | 'version'
  | 'created_at'
>

export type SiteForgeProjectShell = {
  websiteId: string
  orgId: string
  propertyId: string
  status: 'planning'
  generationStatus: string | null
  generationProgress: number
  currentStep: string
  version: number
  createdAt: string | null
}

export class SiteForgeProjectError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeProjectError'
  }
}

function presentProject(row: WebsiteRow): SiteForgeProjectShell {
  return {
    websiteId: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    status: 'planning',
    generationStatus: row.generation_status,
    generationProgress: row.generation_progress || 0,
    currentStep: row.current_step || 'Planning project',
    version: row.version || 1,
    createdAt: row.created_at,
  }
}

async function findReusableProject(
  input: { orgId: string; propertyId: string },
  client: ServiceClient
): Promise<WebsiteRow | null> {
  const { data, error } = await client
    .from('property_websites')
    .select(
      'id, org_id, property_id, generation_status, generation_progress, current_step, version, created_at'
    )
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .in('generation_status', ['queued', 'planning_architecture'])
    .is('generation_input', null)
    .is('generation_started_at', null)
    .is('current_artifact_version_id', null)
    .is('canonical_preview_artifact_id', null)
    .is('staging_artifact_id', null)
    .is('production_artifact_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new SiteForgeProjectError(
      'Failed to inspect existing SiteForge projects',
      500
    )
  }
  return data
}

export async function createOrReuseSiteForgeProject(
  input: { orgId: string; propertyId: string },
  client: ServiceClient = createServiceClient()
): Promise<{ project: SiteForgeProjectShell; reused: boolean }> {
  const { data: property, error: propertyError } = await client
    .from('properties')
    .select('id, org_id')
    .eq('id', input.propertyId)
    .eq('org_id', input.orgId)
    .maybeSingle()

  if (propertyError) {
    throw new SiteForgeProjectError(
      'Failed to verify SiteForge property ownership',
      500
    )
  }
  if (!property) {
    throw new SiteForgeProjectError('Property not found', 404)
  }

  const reusable = await findReusableProject(input, client)
  if (reusable) {
    return { project: presentProject(reusable), reused: true }
  }

  const { data: latest, error: latestError } = await client
    .from('property_websites')
    .select('version')
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new SiteForgeProjectError(
      'Failed to inspect SiteForge project history',
      500
    )
  }

  const { data: created, error: createError } = await client
    .from('property_websites')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      version: (latest?.version || 0) + 1,
      generation_status: 'queued',
      generation_progress: 0,
      current_step: 'Planning project',
    })
    .select(
      'id, org_id, property_id, generation_status, generation_progress, current_step, version, created_at'
    )
    .single()

  if (createError || !created) {
    if (createError?.code === '23505') {
      const racedProject = await findReusableProject(input, client)
      if (racedProject) {
        return { project: presentProject(racedProject), reused: true }
      }
    }
    throw new SiteForgeProjectError(
      'Failed to create SiteForge project shell',
      createError?.code === '23505' ? 409 : 500
    )
  }

  return { project: presentProject(created), reused: false }
}
