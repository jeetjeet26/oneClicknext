import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { PermanentOutboxError, SiteForgeOutboxRegistry } from './outbox'
import { syncLeadToCRM } from '@/utils/services/crm-sync'
import { startWorkflow } from '@/utils/services/workflow-processor'
import { trackEngagementEvent } from '@/utils/services/engagement-tracker'
import type { EventType } from '@/utils/services/leadpulse-events'
import { isSafePublicHttpUrl } from '@/utils/services/url-safety'

type WebhookPayload = {
  destinationUrl: string
  body?: unknown
}

function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  const candidate = mapped || normalized
  if (isIP(candidate) === 4) {
    const [a, b, c] = candidate.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  )
}

export async function assertSafeAnalyticsWebhookUrl(
  value: string,
  resolver: typeof lookup = lookup
): Promise<URL> {
  if (!isSafePublicHttpUrl(value)) {
    throw new PermanentOutboxError('Webhook destination is not a public URL')
  }
  const url = new URL(value)
  if (url.protocol !== 'https:') {
    throw new PermanentOutboxError('Webhook destination must use HTTPS')
  }
  const allowlist = (process.env.SITEFORGE_ANALYTICS_WEBHOOK_HOST_ALLOWLIST || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.length && !allowlist.includes(url.hostname.toLowerCase())) {
    throw new PermanentOutboxError('Webhook destination host is not allowlisted')
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await resolver(url.hostname, { all: true })
  } catch {
    throw new PermanentOutboxError('Webhook destination DNS resolution failed')
  }
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some(result => isPrivateOrReservedAddress(result.address))
  ) {
    throw new PermanentOutboxError(
      'Webhook destination resolves to a private or reserved address'
    )
  }
  return url
}

export function createSiteForgeHandlerRegistry(
  fetcher: typeof fetch = fetch
): SiteForgeOutboxRegistry {
  const registry = new SiteForgeOutboxRegistry().register(
    'analytics.webhook',
    'v1',
    async (event, context) => {
      const payload = event.payload as WebhookPayload
      if (!payload.destinationUrl) {
        throw new PermanentOutboxError('Webhook event has no destination URL')
      }
      const destination = await assertSafeAnalyticsWebhookUrl(
        payload.destinationUrl
      )
      const response = await fetcher(destination, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': context.idempotencyKey,
          'X-SiteForge-Event-Id': event.id,
        },
        body: JSON.stringify(payload.body ?? event.payload),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        const message = `Webhook returned HTTP ${response.status}`
        if (response.status < 500 && ![408, 429].includes(response.status)) {
          throw new PermanentOutboxError(message)
        }
        throw new Error(message)
      }
      return {
        provider: 'webhook',
        providerRequestId: response.headers.get('x-request-id') || undefined,
        providerResponse: { status: response.status },
      }
    }
  )
  registry.register('crm.lead_sync', 'v1', async (event, context) => {
    const payload = event.payload as {
      propertyId?: string
      leadId?: string
      lead?: Parameters<typeof syncLeadToCRM>[2]
    }
    if (!payload.propertyId || !payload.leadId || !payload.lead) {
      throw new PermanentOutboxError('CRM lead sync payload is incomplete')
    }
    const result = await syncLeadToCRM(payload.propertyId, payload.leadId, payload.lead)
    if (!result.success) throw new Error(result.error || 'CRM lead sync failed')
    return {
      provider: 'crm',
      providerRequestId: context.idempotencyKey,
      providerResponse: { success: true },
    }
  })
  registry.register('workflow.start', 'v1', async (event, context) => {
    const payload = event.payload as {
      propertyId?: string
      leadId?: string
      trigger?: string
    }
    if (!payload.propertyId || !payload.leadId || !payload.trigger) {
      throw new PermanentOutboxError('Workflow start payload is incomplete')
    }
    const result = await startWorkflow(
      payload.leadId,
      payload.propertyId,
      payload.trigger
    )
    if (!result.success) throw new Error(result.error || 'Workflow start failed')
    return {
      provider: 'p11-workflow',
      providerRequestId: context.idempotencyKey,
      providerResponse: { workflowId: result.workflowId || null },
    }
  })
  registry.register('leadpulse.engagement', 'v1', async (event, context) => {
    const payload = event.payload as {
      propertyId?: string
      leadId?: string
      eventType?: EventType
      metadata?: Record<string, unknown>
    }
    if (!payload.propertyId || !payload.leadId || !payload.eventType) {
      throw new PermanentOutboxError('LeadPulse engagement payload is incomplete')
    }
    await trackEngagementEvent({
      propertyId: payload.propertyId,
      leadId: payload.leadId,
      eventType: payload.eventType,
      metadata: payload.metadata,
      idempotencyKey: context.idempotencyKey,
    })
    return {
      provider: 'leadpulse',
      providerRequestId: context.idempotencyKey,
      providerResponse: { recorded: true },
    }
  })
  return registry
}
