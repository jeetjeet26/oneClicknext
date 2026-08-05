import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { acknowledgeIncident, authorizeIncident } = vi.hoisted(() => ({
  acknowledgeIncident: vi.fn(),
  authorizeIncident: vi.fn(),
}))

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeIncident: authorizeIncident,
}))
vi.mock('@/utils/siteforge/incidents', () => ({
  acknowledgeSiteForgeIncident: acknowledgeIncident,
}))

const incidentId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

function request(rationale = 'Operator acknowledged and is investigating.'): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/incidents/${incidentId}/acknowledge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rationale }),
    }
  ) as NextRequest
}

function context(id = incidentId) {
  return { params: Promise.resolve({ incidentId: id }) }
}

describe('SiteForge incident acknowledgement route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeIncident.mockResolvedValue({ user: { id: userId } })
    acknowledgeIncident.mockResolvedValue({
      id: incidentId,
      status: 'acknowledged',
    })
  })

  it('validates the incident and rationale before authorization', async () => {
    const { POST } = await import('./route')
    const response = await POST(request('no'), context())

    expect(response.status).toBe(400)
    expect(authorizeIncident).not.toHaveBeenCalled()
  })

  it('does not acknowledge an incident outside the user tenant', async () => {
    authorizeIncident.mockResolvedValue({ error: 'Forbidden', status: 403 })
    const { POST } = await import('./route')
    const response = await POST(request(), context())

    expect(response.status).toBe(403)
    expect(authorizeIncident).toHaveBeenCalledWith(incidentId)
    expect(acknowledgeIncident).not.toHaveBeenCalled()
  })

  it('records an acknowledgement by the authorized operator', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      incident: { id: incidentId, status: 'acknowledged' },
    })
    expect(acknowledgeIncident).toHaveBeenCalledWith({
      incidentId,
      actorId: userId,
      rationale: 'Operator acknowledged and is investigating.',
    })
  })
})
