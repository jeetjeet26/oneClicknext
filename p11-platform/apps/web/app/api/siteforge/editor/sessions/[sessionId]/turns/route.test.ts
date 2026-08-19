import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  createClient,
  createServiceClient,
  getUser,
  start,
  validateSiteForgeOwnerOperatorAccess,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
  start: vi.fn(),
  validateSiteForgeOwnerOperatorAccess: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('workflow/api', () => ({ start }))
vi.mock('@/utils/services/auth-guard', () => ({
  validateSiteForgeOwnerOperatorAccess,
}))

const sessionId = '11111111-1111-4111-8111-111111111111'

function request() {
  return new Request(
    `http://localhost/api/siteforge/editor/sessions/${sessionId}/turns`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'Make the site feel warmer and update the navigation.',
        expectedArtifactId: '22222222-2222-4222-8222-222222222222',
        expectedContentHash: 'a'.repeat(64),
        clientRequestId: 'request-12345678',
      }),
    }
  ) as NextRequest
}

describe('semantic editor turn route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
  })

  it('requires authentication before creating durable work', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ sessionId }),
    })
    expect(response.status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('fails closed when the editor feature is disabled', async () => {
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'false')
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ sessionId }),
    })
    expect(response.status).toBe(404)
    expect(start).not.toHaveBeenCalled()
  })

  it('requires tenant owner/operator authority before page management', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validateSiteForgeOwnerOperatorAccess.mockResolvedValue({
      authorized: false,
      capability: 'siteforge.owner_operator',
    })
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn(async () => ({
        data: {
          id: sessionId,
          org_id: 'org-1',
          property_id: 'property-1',
          website_id: 'website-1',
          status: 'active',
          active_artifact_id: '22222222-2222-4222-8222-222222222222',
        },
        error: null,
      })),
    }
    createServiceClient.mockReturnValue({ from: vi.fn(() => chain) })

    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ sessionId }),
    })

    expect(response.status).toBe(403)
    expect(validateSiteForgeOwnerOperatorAccess).toHaveBeenCalledWith(
      'user-1',
      'property-1'
    )
    expect(start).not.toHaveBeenCalled()
  })

  it('accepts structured page actions without a separate scope authorization', async () => {
    const { turnSchema } = await import('./route')
    const result = turnSchema.safeParse({
      userIntent: 'Remove a page.',
      expectedArtifactId: '22222222-2222-4222-8222-222222222222',
      expectedContentHash: 'a'.repeat(64),
      clientRequestId: 'request-12345678',
      editScope: { kind: 'page', pageSlug: 'amenities' },
      pageManagerAction: {
        type: 'remove',
        pageSlug: 'amenities',
        redirectToSlug: 'home',
      },
    })

    expect(result.success).toBe(true)
  })

  it('uses the durable job identity for replay and terminalizes startup failures', async () => {
    const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8')

    expect(source).toContain(".eq('dedupe_key', dedupeKey)")
    expect(source).toContain(".eq('shared_job_id', duplicateJob.id)")
    // shared_job_id is unique per job: only the assistant message and the
    // workflow input may carry it, never the user message insert.
    expect(source.match(/sharedJobId: job\.id/g)).toHaveLength(2)
    expect(source).toContain(
      ".eq('client_request_id', parsed.data.clientRequestId)"
    )
    expect(source).toContain("status_reason: 'workflow_start_failed'")
    expect(source).toContain('Failed to link semantic edit workflow')
    expect(source).toContain("'siteforge_edit_attachments'")
    expect(source).toContain('attachmentIds')
    expect(source).toContain(
      'Another semantic edit is already active for this website'
    )
    expect(source).toContain('siteForgePageManagerActionSchema')
    expect(source).toContain('pageManagerAction: parsed.data.pageManagerAction')
    expect(source).toContain('editScope: effectiveEditScope')
    expect(source).toContain('pageManagerActionSummary')
  })
})
