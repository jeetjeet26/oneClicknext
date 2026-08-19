import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  SITEFORGE_CERTIFICATION_POLICY_VERSION,
  lighthouseArtifactSchema,
} from './browser-evidence'
import type {
  BrowserCertificationArtifactWriter,
  LighthouseReportArtifact,
} from './browserbase-certifier'
import type { CertificationArtifactBinding } from './certification-binding'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

const providerResponseSchema = z.object({
  runs: z.array(
    z.object({
      url: z.string().url(),
      formFactor: z.literal('mobile'),
      providerRunId: z.string().min(1).max(500),
      generatedAt: z.string().datetime(),
      reportBase64: z.string().min(1),
      reportSha256: sha256Schema,
      runnerBinarySha256: sha256Schema,
      runnerConfigSha256: sha256Schema,
      toolManifestSha256: sha256Schema,
    })
  ),
})

export interface LighthouseProvisioningInput {
  targetUrl: string
  expectedUrls: string[]
  credentials?: { username: string; password: string }
  environment: 'staging' | 'production'
  access: 'protected' | 'public'
  requireIndexable: boolean
  artifact: CertificationArtifactBinding
  bindingHash: string
}

export interface ProvisionedLighthouseReport {
  artifact: LighthouseReportArtifact
  bytes: Uint8Array
}

export interface LighthouseEvidenceProvider {
  readonly name: string
  provision(
    input: LighthouseProvisioningInput
  ): Promise<ProvisionedLighthouseReport[]>
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizedUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function assertHttpsProviderEndpoint(endpoint: URL): void {
  const local =
    endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1'
  if (
    endpoint.protocol !== 'https:' &&
    !(process.env.NODE_ENV !== 'production' && local)
  ) {
    throw new Error('SITEFORGE_LIGHTHOUSE_PROVIDER_URL must use HTTPS')
  }
}

export class HttpLighthouseEvidenceProvider
  implements LighthouseEvidenceProvider
{
  readonly name = 'http-lighthouse'

  constructor(
    private readonly endpoint: URL,
    private readonly secret: string
  ) {
    assertHttpsProviderEndpoint(endpoint)
    if (secret.length < 32) {
      throw new Error(
        'SITEFORGE_LIGHTHOUSE_PROVIDER_SECRET must contain at least 32 characters'
      )
    }
  }

  async provision(
    input: LighthouseProvisioningInput
  ): Promise<ProvisionedLighthouseReport[]> {
    const requestBody = JSON.stringify({
      policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
      targetUrl: input.targetUrl,
      expectedUrls: input.expectedUrls,
      credentials: input.credentials,
      environment: input.environment,
      access: input.access,
      requireIndexable: input.requireIndexable,
      artifact: input.artifact,
      bindingHash: input.bindingHash,
      formFactors: ['mobile'],
    })
    let response: Response | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(
          Number(
            process.env.SITEFORGE_LIGHTHOUSE_PROVIDER_TIMEOUT_MS || 180_000
          )
        ),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secret}`,
        },
        body: requestBody,
      })
      if (![429, 503].includes(response.status) || attempt === 2) break
      const retryAfter = Number(response.headers.get('retry-after') || 0)
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1_000, 60_000)
        : 5_000 * 2 ** attempt
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
    if (!response) {
      throw new Error('External Lighthouse provider returned no response')
    }
    if (!response.ok) {
      throw new Error(
        `External Lighthouse provider failed with HTTP ${response.status}`
      )
    }
    const parsed = providerResponseSchema.parse(await response.json())
    const expected = new Set(input.expectedUrls.map(normalizedUrl))
    const seen = new Set<string>()
    const reports = parsed.runs.map(run => {
      const normalized = normalizedUrl(run.url)
      if (!expected.has(normalized) || seen.has(normalized)) {
        throw new Error(
          'External Lighthouse provider returned an unexpected or duplicate URL'
        )
      }
      seen.add(normalized)
      const bytes = Buffer.from(run.reportBase64, 'base64')
      if (!bytes.byteLength || sha256(bytes) !== run.reportSha256) {
        throw new Error('External Lighthouse report digest does not match bytes')
      }
      const storagePath = [
        'browser-certification',
        input.artifact.artifactId,
        input.environment,
        'lighthouse',
        sha256(normalized).slice(0, 20),
        `${run.providerRunId.replace(/[^a-zA-Z0-9._-]/g, '_')}-${run.reportSha256}.json`,
      ].join('/')
      const artifact = lighthouseArtifactSchema.parse({
        url: run.url,
        formFactor: run.formFactor,
        storagePath,
        sha256: run.reportSha256,
        provider: this.name,
        providerRunId: run.providerRunId,
        runnerBinarySha256: run.runnerBinarySha256,
        runnerConfigSha256: run.runnerConfigSha256,
        toolManifestSha256: run.toolManifestSha256,
        environment: input.environment,
        access: input.access,
        bindingHash: input.bindingHash,
        generatedAt: run.generatedAt,
      })
      return { artifact, bytes: new Uint8Array(bytes) }
    })
    if (seen.size !== expected.size) {
      throw new Error(
        'External Lighthouse provider did not return every expected URL'
      )
    }
    return reports
  }
}

export function getConfiguredLighthouseEvidenceProvider():
  | LighthouseEvidenceProvider
  | null {
  const endpoint = process.env.SITEFORGE_LIGHTHOUSE_PROVIDER_URL
  const secret = process.env.SITEFORGE_LIGHTHOUSE_PROVIDER_SECRET
  if (!endpoint && !secret) return null
  if (!endpoint || !secret) {
    throw new Error('External Lighthouse provider configuration is incomplete')
  }
  return new HttpLighthouseEvidenceProvider(new URL(endpoint), secret)
}

export async function provisionLighthouseReportArtifacts(input: {
  provisioning: LighthouseProvisioningInput
  artifactWriter: BrowserCertificationArtifactWriter
  provider?: LighthouseEvidenceProvider | null
}): Promise<LighthouseReportArtifact[]> {
  const provider =
    input.provider === undefined
      ? getConfiguredLighthouseEvidenceProvider()
      : input.provider
  if (!provider) {
    throw new Error(
      'External Lighthouse provider is required for staging and production certification'
    )
  }
  const provisioned = await provider.provision(input.provisioning)
  for (const report of provisioned) {
    await input.artifactWriter({
      storagePath: report.artifact.storagePath,
      bytes: report.bytes,
      contentType: 'application/json',
      sha256: report.artifact.sha256,
    })
  }
  return provisioned.map(report => report.artifact)
}
