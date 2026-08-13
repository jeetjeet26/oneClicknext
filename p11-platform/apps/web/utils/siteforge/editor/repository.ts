import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'

type SiteForgeClient = SupabaseClient<Database>

export type EditorSession = Tables<'siteforge_edit_sessions'>
export type EditorMessage = Tables<'siteforge_edit_messages'>

export interface CreateEditorSessionInput {
  websiteId: string
  propertyId: string
  orgId: string
  artifactId: string
  userId: string
  title?: string
}

export async function getOrCreateEditorSession(
  input: CreateEditorSessionInput,
  client: SiteForgeClient = createServiceClient()
): Promise<EditorSession> {
  const { data: existing, error: existingError } = await client
    .from('siteforge_edit_sessions')
    .select('*')
    .eq('website_id', input.websiteId)
    .eq('created_by', input.userId)
    .eq('status', 'active')
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed to load editor session: ${existingError.message}`)
  }
  if (existing) {
    if (existing.active_artifact_id !== input.artifactId) {
      const { data: refreshed, error: refreshError } = await client
        .from('siteforge_edit_sessions')
        .update({
          active_artifact_id: input.artifactId,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (refreshError || !refreshed) {
        throw new Error(
          `Failed to refresh editor session: ${refreshError?.message || 'missing row'}`
        )
      }
      return refreshed
    }
    return existing
  }

  const { data: created, error: createError } = await client
    .from('siteforge_edit_sessions')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      active_artifact_id: input.artifactId,
      created_by: input.userId,
      title: input.title?.trim() || null,
    })
    .select('*')
    .single()

  if (createError?.code === '23505') {
    // Concurrent React mounts can both observe no active session. The unique
    // active-session index decides the winner; reuse it instead of surfacing a
    // false editor failure to the operator.
    return getOrCreateEditorSession(input, client)
  }
  if (createError || !created) {
    throw new Error(
      `Failed to create editor session: ${createError?.message || 'missing row'}`
    )
  }
  return created
}

export async function listEditorMessages(
  sessionId: string,
  client: SiteForgeClient = createServiceClient()
): Promise<EditorMessage[]> {
  const { data, error } = await client
    .from('siteforge_edit_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    throw new Error(`Failed to load editor messages: ${error.message}`)
  }
  return data || []
}

export interface CreateEditorMessageInput {
  sessionId: string
  orgId: string
  propertyId: string
  websiteId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status?: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  content: string
  clientRequestId?: string
  parentArtifactId?: string
  parentContentHash?: string
  sharedJobId?: string
  resultingArtifactId?: string
  toolSummary?: Json
  progress?: Json
  failureCode?: string
  failureMessage?: string
  createdBy?: string
}

export async function createEditorMessage(
  input: CreateEditorMessageInput,
  client: SiteForgeClient = createServiceClient()
): Promise<EditorMessage> {
  const { data, error } = await client
    .from('siteforge_edit_messages')
    .insert({
      session_id: input.sessionId,
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      role: input.role,
      status: input.status || 'complete',
      content: input.content,
      client_request_id: input.clientRequestId || null,
      parent_artifact_id: input.parentArtifactId || null,
      parent_content_hash: input.parentContentHash || null,
      shared_job_id: input.sharedJobId || null,
      resulting_artifact_id: input.resultingArtifactId || null,
      tool_summary: input.toolSummary ?? [],
      progress: input.progress ?? [],
      failure_code: input.failureCode || null,
      failure_message: input.failureMessage || null,
      created_by: input.createdBy || null,
      completed_at:
        (input.status || 'complete') === 'complete'
          ? new Date().toISOString()
          : null,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(
      `Failed to persist editor message: ${error?.message || 'missing row'}`
    )
  }
  await client
    .from('siteforge_edit_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', input.sessionId)
  return data
}

export async function updateEditorMessage(
  messageId: string,
  update: {
    status?: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
    content?: string
    resultingArtifactId?: string | null
    toolSummary?: Json
    progress?: Json
    failureCode?: string | null
    failureMessage?: string | null
    expectedStatuses?: Array<
      'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
    >
  },
  client: SiteForgeClient = createServiceClient()
): Promise<void> {
  const terminal = update.status
    ? ['complete', 'failed', 'cancelled'].includes(update.status)
    : false
  let query = client
    .from('siteforge_edit_messages')
    .update({
      status: update.status,
      content: update.content,
      resulting_artifact_id: update.resultingArtifactId,
      tool_summary: update.toolSummary,
      progress: update.progress,
      failure_code: update.failureCode,
      failure_message: update.failureMessage,
      completed_at: terminal ? new Date().toISOString() : undefined,
    })
    .eq('id', messageId)
  if (update.expectedStatuses?.length) {
    query = query.in('status', update.expectedStatuses)
  }
  const { error } = await query

  if (error) {
    throw new Error(`Failed to update editor message: ${error.message}`)
  }
}
