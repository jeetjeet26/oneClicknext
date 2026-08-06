import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { createClient, createServiceClient, getUser, start } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
  start: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('workflow/api', () => ({ start }))

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
  })
})
