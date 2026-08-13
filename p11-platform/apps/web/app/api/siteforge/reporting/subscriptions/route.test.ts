import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { authorizeWebsite, insert, single, update } = vi.hoisted(() => ({
  authorizeWebsite: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeWebsite: authorizeWebsite,
}))

const websiteId = '11111111-1111-4111-8111-111111111111'
const subscriptionId = '22222222-2222-4222-8222-222222222222'

function post(body: Record<string, unknown>) {
  return new Request(
    'http://localhost/api/siteforge/reporting/subscriptions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

function patch(body: Record<string, unknown>) {
  return new Request(
    'http://localhost/api/siteforge/reporting/subscriptions',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

describe('SiteForge report subscriptions route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    single.mockResolvedValue({
      data: {
        id: 'subscription-1',
        website_id: websiteId,
        recipient_email: 'owner@example.com',
        cadence: 'weekly',
        status: 'active',
      },
      error: null,
    })
    insert.mockReturnValue({ select: vi.fn(() => ({ single })) })
    const updateChain = {
      eq: vi.fn(),
      select: vi.fn(() => ({ single })),
    }
    updateChain.eq.mockReturnValue(updateChain)
    update.mockReturnValue(updateChain)
    authorizeWebsite.mockResolvedValue({
      user: { id: 'user-1' },
      website: {
        id: websiteId,
        org_id: 'org-1',
        property_id: 'property-1',
      },
      service: { from: vi.fn(() => ({ insert, update })) },
    })
  })

  it('validates recipient and cadence before authorization', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      post({
        websiteId,
        recipientEmail: 'invalid',
        cadence: 'hourly',
        sections: ['funnels'],
      })
    )
    expect(response.status).toBe(400)
    expect(authorizeWebsite).not.toHaveBeenCalled()
  })

  it('rejects legacy daily cadence and cancelled status', async () => {
    const { PATCH, POST } = await import('./route')
    const createResponse = await POST(
      post({
        websiteId,
        recipientEmail: 'owner@example.com',
        cadence: 'daily',
        sections: ['funnels'],
      })
    )
    const updateResponse = await PATCH(
      patch({
        websiteId,
        subscriptionId,
        status: 'cancelled',
      })
    )

    expect(createResponse.status).toBe(400)
    expect(updateResponse.status).toBe(400)
    expect(authorizeWebsite).not.toHaveBeenCalled()
  })

  it('requires manager access and does not send email', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      post({
        websiteId,
        recipientEmail: 'Owner@Example.com',
        cadence: 'weekly',
        sections: ['funnels', 'incidents'],
      })
    )
    expect(response.status).toBe(201)
    expect(authorizeWebsite).toHaveBeenCalledWith(websiteId, true)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_email: 'owner@example.com',
        cadence: 'weekly',
      })
    )
    await expect(response.json()).resolves.toMatchObject({
      emailSent: false,
      providerInvoked: false,
    })
  })

  it('accepts quarterly cadence and revoked status', async () => {
    const { PATCH, POST } = await import('./route')
    const createResponse = await POST(
      post({
        websiteId,
        recipientEmail: 'owner@example.com',
        cadence: 'quarterly',
        sections: ['funnels'],
      })
    )
    const updateResponse = await PATCH(
      patch({
        websiteId,
        subscriptionId,
        status: 'revoked',
      })
    )

    expect(createResponse.status).toBe(201)
    expect(updateResponse.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cadence: 'quarterly',
        next_send_at: expect.any(String),
      })
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'revoked',
        next_send_at: null,
      })
    )
  })
})
