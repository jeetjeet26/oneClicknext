import { SITEFORGE_CERTIFICATION_POLICY_VERSION } from './browser-evidence'
import type { CertificationArtifactBinding } from './certification-binding'

export async function collectBrowserCertificationEvidence(input: {
  targetUrl: string
  expectedUrls: string[]
  credentials?: { username: string; password: string }
  environment: 'protected_preview' | 'staging' | 'production'
  access: 'protected' | 'public'
  requireIndexable: boolean
  artifact: CertificationArtifactBinding
  bindingHash: string
}): Promise<unknown | undefined> {
  const endpoint = process.env.SITEFORGE_BROWSER_CERTIFIER_URL
  if (!endpoint) return undefined
  const parsed = new URL(endpoint)
  const localEndpoint =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && localEndpoint)) {
    throw new Error('SITEFORGE_BROWSER_CERTIFIER_URL must use HTTPS')
  }
  const secret = process.env.SITEFORGE_BROWSER_CERTIFIER_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SITEFORGE_BROWSER_CERTIFIER_SECRET must contain at least 32 characters')
  }

  const response = await fetch(parsed, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(
      Number(process.env.SITEFORGE_BROWSER_CERTIFIER_TIMEOUT_MS || 290_000)
    ),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
      environment: input.environment,
      access: input.access,
      requireIndexable: input.requireIndexable,
      artifact: input.artifact,
      bindingHash: input.bindingHash,
      targetUrl: input.targetUrl,
      expectedUrls: input.expectedUrls,
      credentials: input.credentials,
    }),
  })
  if (!response.ok) {
    throw new Error(`Browser certifier failed with HTTP ${response.status}`)
  }
  const payload = await response.json() as { evidence?: unknown }
  if (!payload.evidence) {
    throw new Error('Browser certifier returned no evidence')
  }
  return payload.evidence
}
