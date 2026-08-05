import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACACIA_REGRESSION_BASELINE_V1 as acacia } from '@/fixtures/acacia-regression.v1'
import {
  auroraMutationHeaders,
  formatAuroraPreflightFailure,
  inspectAuroraLifecycleEnv,
  type AuroraLifecycleConfig,
} from '@/utils/siteforge/testing/aurora-lifecycle-e2e'
import { SITEFORGE_CERTIFICATION_POLICY_VERSION } from '@/utils/siteforge/verification/browser-evidence'

const seededUser = {
  email: 'local-admin@p11.test',
  password: 'local-dev-password',
}

const seededPropertyId = '33333333-3333-3333-3333-333333333333'

async function signInWithSeededUser() {
  // Placeholder to make the intent obvious if more setup gets added later.
  return seededUser
}

async function login(page: Page) {
  const user = await signInWithSeededUser()
  await loginWithUser(page, user)
}

async function loginWithUser(
  page: Page,
  user: { email: string; password: string }
) {
  await page.goto('/auth/login')
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page
    .locator('form')
    .first()
    .getByRole('button', { name: 'Sign in', exact: true })
    .click()

  await expect(page).not.toHaveURL(/\/auth\/login/)
}

async function callAuthedApi(
  page: Page,
  url: string,
  init?: {
    method?: string
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
) {
  return page.evaluate(
    async ({ targetUrl, requestInit }) => {
      const response = await fetch(targetUrl, {
        method: requestInit?.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(requestInit?.headers || {}),
        },
        body: requestInit?.body ? JSON.stringify(requestInit.body) : undefined,
      })
      let data: unknown = null
      try {
        data = await response.json()
      } catch {
        // ignore json parse errors
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
      }
    },
    {
      targetUrl: url,
      requestInit: init,
    }
  )
}

async function callAuroraMutation(
  page: Page,
  config: AuroraLifecycleConfig,
  url: string,
  init: {
    method: string
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
) {
  return callAuthedApi(page, url, {
    ...init,
    headers: {
      ...auroraMutationHeaders(config),
      ...(init.headers || {}),
    },
  })
}

function expectApiOk(
  response: { ok: boolean; status: number; data: unknown },
  label: string
) {
  expect(
    response.ok,
    `${label} failed: ${JSON.stringify({
      status: response.status,
      data: response.data,
    })}`
  ).toBe(true)
}

async function callAuthedTextApi(
  page: Page,
  url: string,
  init?: { method?: string; body?: Record<string, unknown> }
) {
  return page.evaluate(
    async ({ targetUrl, requestInit }) => {
      const response = await fetch(targetUrl, {
        method: requestInit?.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestInit?.body ? JSON.stringify(requestInit.body) : undefined,
      })
      const text = await response.text()

      return {
        ok: response.ok,
        status: response.status,
        text,
        contentType: response.headers.get('content-type') || '',
      }
    },
    {
      targetUrl: url,
      requestInit: init,
    }
  )
}

async function resolvePropertyIdForSmoke(
  page: Page,
  explicitPropertyEnv?: string
): Promise<string> {
  const propertiesResponse = await callAuthedApi(page, '/api/properties')
  expect(propertiesResponse.ok).toBeTruthy()
  const propertiesData = propertiesResponse.data as {
    properties?: Array<{ id?: string; name?: string }>
  }

  let properties = Array.isArray(propertiesData.properties)
    ? propertiesData.properties
    : []

  if (explicitPropertyEnv) {
    const explicitPropertyId = process.env[explicitPropertyEnv]?.trim()
    expect(
      explicitPropertyId,
      `Set ${explicitPropertyEnv}; hosted mutation cannot select an accessible property implicitly.`
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(
      properties.some(property => property.id === explicitPropertyId),
      `${explicitPropertyEnv} does not identify a property accessible to this operator.`
    ).toBe(true)
    return explicitPropertyId as string
  }

  if (properties.length === 0) {
    const onboardingStatus = await callAuthedApi(page, '/api/onboarding')
    expect(onboardingStatus.ok).toBeTruthy()
    const onboardingData = onboardingStatus.data as { needsOnboarding?: boolean }

    if (onboardingData.needsOnboarding) {
      const onboardingResponse = await callAuthedApi(page, '/api/onboarding', {
        method: 'POST',
        body: {
          organization: { name: 'P11 Smoke Org' },
          property: {
            name: 'P11 Smoke Property',
            type: 'multifamily',
            address: { city: 'Austin', state: 'TX' },
          },
          contacts: [
            {
              type: 'primary',
              name: 'Local Smoke Admin',
              email: seededUser.email,
            },
          ],
        },
      })
      expect(onboardingResponse.ok).toBeTruthy()
    } else {
      const createPropertyResponse = await callAuthedApi(page, '/api/properties', {
        method: 'POST',
        body: { name: 'P11 Smoke Property' },
      })
      expect(createPropertyResponse.ok).toBeTruthy()
    }

    const refreshedPropertiesResponse = await callAuthedApi(page, '/api/properties')
    expect(refreshedPropertiesResponse.ok).toBeTruthy()
    const refreshedData = refreshedPropertiesResponse.data as {
      properties?: Array<{ id?: string; name?: string }>
    }
    properties = Array.isArray(refreshedData.properties) ? refreshedData.properties : []
  }

  const namedProperty = properties.find(
    property => property.name === 'P11 Local Demo Property' && typeof property.id === 'string'
  )
  if (namedProperty?.id) return namedProperty.id

  const smokeProperty = properties.find(
    property => property.name === 'P11 Smoke Property' && typeof property.id === 'string'
  )
  if (smokeProperty?.id) return smokeProperty.id

  return seededPropertyId
}

async function ensurePropertyAuditQueries(
  page: Page,
  propertyId: string
) {
  const queriesResponse = await callAuthedApi(
    page,
    `/api/propertyaudit/queries?propertyId=${propertyId}&includePerformance=false`
  )
  expect(queriesResponse.ok, `Failed to load PropertyAudit queries: ${JSON.stringify(queriesResponse)}`).toBeTruthy()

  const queriesData = queriesResponse.data as {
    queries?: Array<{ id?: string; text?: string }>
  }
  const existingQueries = Array.isArray(queriesData.queries) ? queriesData.queries : []
  if (existingQueries.length > 0) {
    return existingQueries
  }

  const generateResponse = await callAuthedApi(page, '/api/propertyaudit/queries', {
    method: 'POST',
    body: {
      propertyId,
      generateFromProperty: true,
    },
  })
  expect(
    generateResponse.ok,
    `Failed to generate PropertyAudit query panel: ${JSON.stringify(generateResponse)}`
  ).toBeTruthy()

  const refreshedQueriesResponse = await callAuthedApi(
    page,
    `/api/propertyaudit/queries?propertyId=${propertyId}&includePerformance=false`
  )
  expect(
    refreshedQueriesResponse.ok,
    `Failed to reload PropertyAudit queries: ${JSON.stringify(refreshedQueriesResponse)}`
  ).toBeTruthy()

  const refreshedQueriesData = refreshedQueriesResponse.data as {
    queries?: Array<{ id?: string; text?: string }>
  }
  const refreshedQueries = Array.isArray(refreshedQueriesData.queries)
    ? refreshedQueriesData.queries
    : []

  expect(refreshedQueries.length).toBeGreaterThan(0)
  return refreshedQueries
}

async function waitForWebsiteStatus(
  page: Page,
  websiteId: string,
  terminalStatuses: string[],
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs
  let lastResponse: { ok: boolean; status: number; data: unknown } | null = null

  while (Date.now() < deadline) {
    const statusResponse = await callAuthedApi(page, `/api/siteforge/status/${websiteId}`)
    lastResponse = statusResponse

    if (!statusResponse.ok) {
      const payload = statusResponse.data as { error?: unknown } | null
      const detail =
        payload && typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${statusResponse.status}`
      const action =
        statusResponse.status === 401
          ? 'The smoke session expired; sign in again.'
          : statusResponse.status === 403
            ? 'The seeded user cannot access this SiteForge website.'
            : statusResponse.status >= 500
              ? 'The SiteForge status route failed; inspect local server logs.'
              : 'The SiteForge status request was rejected.'
      throw new Error(`${action} ${detail}`)
    }

    const statusData = statusResponse.data as Record<string, unknown>
    const status = typeof statusData.status === 'string' ? statusData.status : ''
    if (terminalStatuses.includes(status)) {
      return statusData
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(
    `Timed out waiting for website status ${terminalStatuses.join(', ')}: ${JSON.stringify(lastResponse)}`
  )
}

async function waitForCanonicalPreviewJob(
  page: Page,
  websiteId: string,
  jobId: string,
  timeoutMs = 300_000
) {
  const deadline = Date.now() + timeoutMs
  let lastResponse: { ok: boolean; status: number; data: unknown } | null = null

  while (Date.now() < deadline) {
    const response = await callAuthedApi(
      page,
      `/api/siteforge/canonical-preview/${websiteId}?jobId=${jobId}`
    )
    lastResponse = response
    if (response.ok) {
      const data = response.data as {
        status?: string
        error?: string | null
      }
      if (
        data.status === 'succeeded' ||
        data.status === 'failed' ||
        data.status === 'cancelled'
      ) {
        return data
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(
    `Timed out waiting for canonical preview job ${jobId}: ${JSON.stringify(lastResponse)}`
  )
}

async function createApprovedSiteForgeGeneration(
  page: Page,
  propertyId: string,
  operatorDirection: string,
  options: { simulate?: boolean } = { simulate: true }
) {
  const preferences = {
    style: 'modern',
    emphasis: 'amenities',
    ctaPriority: 'contact',
    enabledCapabilities: [],
  }
  const readinessResponse = await callAuthedApi(page, '/api/onboarding/readiness', {
    method: 'POST',
    body: { propertyId },
  })
  expect(
    readinessResponse.ok,
    `SiteForge readiness build failed: ${JSON.stringify(readinessResponse)}`
  ).toBeTruthy()
  const readiness = readinessResponse.data as {
    snapshot?: { id?: string; status?: string; unresolved_conflicts?: unknown[] }
  }
  if (readiness.snapshot?.status !== 'approved') {
    expect(
      readiness.snapshot?.status,
      `SiteForge readiness is blocked: ${JSON.stringify(readiness.snapshot)}`
    ).toBe('ready')
    const readinessApproval = await callAuthedApi(
      page,
      `/api/onboarding/readiness/${readiness.snapshot?.id}/approve`,
      {
        method: 'POST',
        body: {
          propertyId,
          rationale: 'Local smoke approves the evidence-backed onboarding snapshot.',
        },
      }
    )
    expect(
      readinessApproval.ok,
      `SiteForge readiness approval failed: ${JSON.stringify(readinessApproval)}`
    ).toBeTruthy()
  }
  const planResponse = await callAuthedApi(page, '/api/siteforge/plan', {
    method: 'POST',
    body: {
      propertyId,
      conversationHistory: [],
      userMessage: operatorDirection,
      preferences,
    },
  })
  expect(
    planResponse.ok,
    `SiteForge plan creation failed: ${JSON.stringify(planResponse)}`
  ).toBeTruthy()
  const plan = planResponse.data as {
    planId?: string
    planVersionId?: string
    revision?: number
    contentHash?: string
    planState?: string
    plan?: { propertyId?: string; preferences?: Record<string, unknown> }
    readiness?: { ready?: boolean; issues?: unknown[] }
  }
  expect(typeof plan.planId).toBe('string')
  expect(typeof plan.planVersionId).toBe('string')
  expect(plan.revision).toBeGreaterThan(0)
  expect(plan.contentHash).toMatch(/^[a-f0-9]{64}$/)
  expect(plan.planState).toBe('ready_for_review')
  expect(plan.plan?.propertyId).toBe(propertyId)
  expect(plan.plan?.preferences).toMatchObject(preferences)
  expect(
    plan.readiness?.ready,
    `SiteForge plan was not ready: ${JSON.stringify(plan.readiness)}`
  ).toBe(true)

  const decisionResponse = await callAuthedApi(
    page,
    `/api/siteforge/plans/${plan.planId as string}/decision`,
    {
      method: 'POST',
      body: {
        propertyId,
        expectedRevision: plan.revision,
        contentHash: plan.contentHash,
        decisionStatus: 'approved',
        decisionReason: 'Local smoke approves this exact immutable plan revision.',
      },
    }
  )
  expect(
    decisionResponse.ok,
    `SiteForge plan approval failed: ${JSON.stringify(decisionResponse)}`
  ).toBeTruthy()
  const decision = decisionResponse.data as {
    status?: string
    revision?: number
    contentHash?: string
    planVersionId?: string
  }
  expect(decision.status).toBe('confirmed')
  expect(decision.revision).toBe(plan.revision)
  expect(decision.contentHash).toBe(plan.contentHash)
  expect(decision.planVersionId).toBe(plan.planVersionId)

  const generateResponse = await callAuthedApi(
    page,
    `/api/siteforge/generate${options.simulate === false ? '' : '?simulate=1'}`,
    {
      method: 'POST',
      body: {
        planId: plan.planId,
        confirmedRevision: plan.revision,
        contentHash: plan.contentHash,
        idempotencyKey: crypto.randomUUID(),
      },
    }
  )
  expect(
    generateResponse.ok,
    `SiteForge generation failed: ${JSON.stringify(generateResponse)}`
  ).toBeTruthy()
  const generation = generateResponse.data as {
    websiteId?: string
    jobId?: string
    status?: string
  }
  expect(typeof generation.websiteId).toBe('string')
  expect(typeof generation.jobId).toBe('string')
  expect(generation.status).toBe('queued')

  return {
    websiteId: generation.websiteId as string,
    jobId: generation.jobId as string,
    planId: plan.planId as string,
    planVersionId: plan.planVersionId as string,
    revision: plan.revision as number,
    contentHash: plan.contentHash as string,
  }
}

async function waitForPropertyAuditRun(
  page: Page,
  runId: string,
  timeoutMs = 900_000
) {
  const deadline = Date.now() + timeoutMs
  let lastResponse: { ok: boolean; status: number; data: unknown } | null = null

  while (Date.now() < deadline) {
    const runResponse = await callAuthedApi(page, `/api/propertyaudit/runs/${runId}`)
    lastResponse = runResponse

    if (runResponse.ok) {
      const runData = runResponse.data as {
        run?: { status?: string; errorMessage?: string | null }
        score?: { overallScore?: number } | null
        answers?: Array<unknown>
      }
      const status = typeof runData.run?.status === 'string' ? runData.run.status : ''

      if (status === 'completed' || status === 'failed') {
        return runData
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(`Timed out waiting for PropertyAudit run ${runId}: ${JSON.stringify(lastResponse)}`)
}

test.describe('Acacia public read-only regression', () => {
  // Run only this external check without starting the local stack:
  // ACACIA_READONLY_EXTERNAL_ONLY=1 ACACIA_READONLY_SMOKE=1 \
  //   npx playwright test --grep "Acacia public read-only regression"
  test('verifies public identity without permitting any write request', async ({
    page,
  }) => {
    test.skip(
      process.env.ACACIA_READONLY_SMOKE !== '1',
      'Set ACACIA_READONLY_SMOKE=1 to run the public, non-mutating Acacia check.'
    )

    const publicUrl =
      process.env.ACACIA_READONLY_PUBLIC_URL || acacia.property.publicUrl
    const blockedWrites: string[] = []
    await page.route('**/*', async route => {
      const request = route.request()
      const method = request.method().toUpperCase()
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        await route.continue()
        return
      }
      blockedWrites.push(`${method} ${request.url()}`)
      await route.abort('blockedbyclient')
    })

    await page.goto(publicUrl, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(/Acacia/i)
    await expect(
      page.getByRole('heading', {
        name: /New Townhomes For Sale in Palo Alto, CA/i,
      })
    ).toBeVisible()
    await expect(page.getByText(acacia.property.address, { exact: true })).toBeVisible()
    await expect(
      page.getByRole('link', { name: acacia.property.phone }).first()
    ).toBeVisible()
    await expect(page.getByText(/final (three )?homes/i).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /3 Beds • 2\.5 Baths/i })).toBeVisible()
    await expect(
      page.locator(`a[href="${acacia.publicSiteLinks.availability}"]`).first()
    ).toBeVisible()
    await expect(
      page
        .locator(
          `a[href*="${new URL(acacia.publicSiteLinks.featuredFloorPlan).pathname}"]`
        )
        .first()
    ).toBeVisible()

    const nativeLauncher = page.getByRole('button', {
      name: /Open .* chat/i,
    })
    if (await nativeLauncher.isVisible().catch(() => false)) {
      await nativeLauncher.click()
      await expect(page.getByRole('dialog')).toBeVisible()
    }

    expect(
      blockedWrites,
      'The Acacia read-only lane attempted an unexpected non-GET/HEAD/OPTIONS request.'
    ).toEqual([])
  })
})

type AuroraArtifact = {
  id: string
  contentHash: string
  immutable?: boolean
  remoteVerified?: boolean
  runtimeContractVersion?: number
  runtimePackageSha256?: string
  runtimeManifestSha256?: string
  baseThemePackageSha256?: string
}

type AuroraResources = {
  identity?: {
    propertyId?: string
    websiteId?: string
    targetId?: string
    rolloutAssignmentId?: string
  }
  currentArtifact?: AuroraArtifact
  rollbackArtifacts?: AuroraArtifact[]
  extensionRequests?: Array<{
    id?: string
    status?: string
    artifactId?: string
  }>
  baselineCandidates?: Array<{
    id?: string
    status?: string
    artifactId?: string
  }>
  certifications?: Array<{
    id?: string
    artifactId?: string
    environment?: string
    access?: string
    status?: string
    policyVersion?: string
  }>
  releases?: Array<{
    id?: string
    state?: string
    artifactId?: string
    contentHash?: string
  }>
  cleanup?: {
    verified?: boolean
    remainingOwnedResourceIds?: string[]
  }
  ownedResourceIds?: string[]
  mutationLeaseViolations?: string[]
  artifactLineage?: string[]
  semanticCoverage?: {
    copy?: boolean
    topology?: boolean
    navigation?: boolean
    footer?: boolean
    forms?: boolean
    seo?: boolean
    redirects?: boolean
    media?: boolean
    knowledge?: boolean
    responsive?: boolean
    accessibility?: boolean
    customInteraction?: boolean
  }
}

async function loadAuroraResources(
  page: Page,
  config: AuroraLifecycleConfig
): Promise<AuroraResources> {
  const separator = config.resourcesUrl.includes('?') ? '&' : '?'
  const response = await callAuthedApi(
    page,
    `${config.resourcesUrl}${separator}ownerId=${encodeURIComponent(config.ownerId)}&websiteId=${encodeURIComponent(config.websiteId)}`
  )
  expectApiOk(response, 'Aurora owned-resource inspection')
  return response.data as AuroraResources
}

async function waitForAuroraResources(
  page: Page,
  config: AuroraLifecycleConfig,
  predicate: (resources: AuroraResources) => boolean,
  label: string,
  timeoutMs = 600_000
) {
  const deadline = Date.now() + timeoutMs
  let last: AuroraResources | null = null
  while (Date.now() < deadline) {
    last = await loadAuroraResources(page, config)
    if (predicate(last)) return last
    await page.waitForTimeout(2_000)
  }
  throw new Error(
    `Timed out waiting for ${label}: ${JSON.stringify({
      identity: last?.identity,
      currentArtifact: last?.currentArtifact,
      extensions: last?.extensionRequests?.map(item => ({
        id: item.id,
        status: item.status,
      })),
      baselines: last?.baselineCandidates?.map(item => ({
        id: item.id,
        status: item.status,
      })),
      certifications: last?.certifications?.map(item => ({
        id: item.id,
        environment: item.environment,
        access: item.access,
        status: item.status,
        policyVersion: item.policyVersion,
      })),
      releases: last?.releases,
      cleanup: last?.cleanup,
    })}`
  )
}

async function waitForAuroraEditorJob(
  page: Page,
  jobId: string,
  timeoutMs = 600_000
) {
  const deadline = Date.now() + timeoutMs
  let last: unknown = null
  while (Date.now() < deadline) {
    const response = await callAuthedApi(
      page,
      `/api/siteforge/editor/jobs/${jobId}`
    )
    expectApiOk(response, `Aurora semantic editor job ${jobId}`)
    last = response.data
    const data = response.data as {
      job?: { lifecycle_status?: string; error_message?: string | null }
      message?: {
        status?: string
        resulting_artifact_id?: string | null
        failure_message?: string | null
      }
    }
    const status = data.job?.lifecycle_status
    if (status === 'succeeded') return data
    if (['failed', 'cancelled'].includes(status || '')) {
      throw new Error(
        `Aurora semantic edit ${status}: ${
          data.job?.error_message || data.message?.failure_message || 'unknown failure'
        }`
      )
    }
    await page.waitForTimeout(2_000)
  }
  throw new Error(
    `Timed out waiting for Aurora semantic editor job ${jobId}: ${JSON.stringify(last)}`
  )
}

async function openAuroraEditorSession(
  page: Page,
  config: AuroraLifecycleConfig
) {
  const response = await callAuroraMutation(
    page,
    config,
    '/api/siteforge/editor/sessions',
    {
      method: 'POST',
      body: {
        websiteId: config.websiteId,
        title: `Aurora lifecycle ${config.ownerId}`,
      },
    }
  )
  expectApiOk(response, 'Open Aurora semantic editor session')
  const data = response.data as {
    session?: { id?: string }
    currentArtifact?: { id?: string; content_hash?: string }
  }
  expect(data.session?.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  )
  expect(data.currentArtifact?.id).toBeTruthy()
  expect(data.currentArtifact?.content_hash).toMatch(/^[a-f0-9]{64}$/)
  return {
    sessionId: data.session?.id as string,
    artifact: {
      id: data.currentArtifact?.id as string,
      contentHash: data.currentArtifact?.content_hash as string,
    },
  }
}

async function submitAuroraSemanticEdit(
  page: Page,
  config: AuroraLifecycleConfig,
  sessionId: string,
  artifact: AuroraArtifact,
  userIntent: string
): Promise<AuroraArtifact> {
  const response = await callAuroraMutation(
    page,
    config,
    `/api/siteforge/editor/sessions/${sessionId}/turns`,
    {
      method: 'POST',
      body: {
        userIntent,
        expectedArtifactId: artifact.id,
        expectedContentHash: artifact.contentHash,
        clientRequestId: `${config.ownerId}:${crypto.randomUUID()}`,
      },
    }
  )
  expectApiOk(response, `Aurora semantic edit: ${userIntent}`)
  const jobId = (response.data as { jobId?: string }).jobId
  expect(jobId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  )
  await waitForAuroraEditorJob(page, jobId as string)
  return (await openAuroraEditorSession(page, config)).artifact
}

async function runCanonicalPreview(
  page: Page,
  config: AuroraLifecycleConfig,
  artifact: AuroraArtifact,
  retry = false
) {
  const response = await callAuroraMutation(
    page,
    config,
    `/api/siteforge/canonical-preview/${config.websiteId}`,
    {
      method: 'POST',
      body: {
        artifactId: artifact.id,
        contentHash: artifact.contentHash,
        ...(retry ? { retry: true } : {}),
      },
    }
  )
  if (response.status === 202) {
    const jobId = (response.data as { jobId?: string }).jobId
    expect(jobId).toBeTruthy()
    return waitForCanonicalPreviewJob(
      page,
      config.websiteId,
      jobId as string,
      900_000
    )
  }
  return response.data as { status?: string; previewUrl?: string; error?: string }
}

test.describe.serial('Aurora same-website runtime-v3 lifecycle', () => {
  test('edits, certifies, promotes, rolls back, restores, and cleans up', async ({
    browser,
    page,
  }) => {
    test.setTimeout(
      Number(process.env.AURORA_LIFECYCLE_TIMEOUT_MS || 7_200_000)
    )
    test.skip(
      process.env.AURORA_LIFECYCLE_E2E !== '1',
      'Set AURORA_LIFECYCLE_E2E=1 only after the explicit fail-closed preflight is complete.'
    )

    const preflight = inspectAuroraLifecycleEnv(process.env)
    expect(preflight.ready, formatAuroraPreflightFailure(preflight)).toBe(true)
    if (!preflight.ready) throw new Error(formatAuroraPreflightFailure(preflight))
    const config = preflight.config
    const mutationHeaders = auroraMutationHeaders(config)
    await page.setExtraHTTPHeaders(mutationHeaders)
    await loginWithUser(page, config.operator)

    const reviewerContext = await browser.newContext({
      baseURL:
        process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
      extraHTTPHeaders: mutationHeaders,
    })
    const reviewerPage = await reviewerContext.newPage()
    let primaryError: unknown = null

    try {
      await loginWithUser(reviewerPage, config.reviewer)

      const leaseResponse = await callAuroraMutation(
        page,
        config,
        config.leaseUrl,
        {
          method: 'POST',
          body: {
            operation: 'acquire',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            targetId: config.targetId,
            rolloutAssignmentId: config.rolloutAssignmentId,
            ownerId: config.ownerId,
            expiresAt: config.expiresAt,
          },
        }
      )
      expectApiOk(leaseResponse, 'Acquire exclusive Aurora lifecycle lease')

      const themeInstallResponse = await callAuroraMutation(
        page,
        config,
        config.resourcesUrl,
        {
          method: 'POST',
          body: {
            operation: 'install_verified_base_theme',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            packageSha256: config.baseThemePackageSha256,
          },
        }
      )
      expectApiOk(
        themeInstallResponse,
        'Install exact Aurora rollback base theme'
      )

      const importBody = {
        operation: 'import_immutable_rollback_baseline',
        propertyId: config.propertyId,
        websiteId: config.websiteId,
        targetId: config.targetId,
        rolloutAssignmentId: config.rolloutAssignmentId,
        runtimePackageSha256: config.runtimePackageSha256,
        runtimeManifestSha256: config.runtimeManifestSha256,
        baseThemePackageSha256: config.baseThemePackageSha256,
        runtimeSigningKeyId: config.runtimeSigningKeyId,
        ownerId: config.ownerId,
        expiresAt: config.expiresAt,
      }
      let importResponse = await callAuroraMutation(
        page,
        config,
        config.importUrl,
        {
          method: 'POST',
          body: importBody,
        }
      )
      if (
        importResponse.status === 409 &&
        (importResponse.data as { code?: string })?.code ===
          'rollback_certification_failed'
      ) {
        const bootstrapResources = await loadAuroraResources(page, config)
        const bootstrapCandidates = (
          bootstrapResources.baselineCandidates || []
        ).filter(
          baseline =>
            baseline.status === 'candidate' &&
            baseline.artifactId === bootstrapResources.currentArtifact?.id
        )
        expect(
          bootstrapCandidates.length,
          'Rollback bootstrap certification must produce reviewable visual baseline candidates.'
        ).toBeGreaterThan(0)
        for (const baseline of bootstrapCandidates) {
          expect(baseline.id).toBeTruthy()
          const decision = await callAuroraMutation(
            reviewerPage,
            config,
            `/api/siteforge/certification/baselines/${baseline.id}/decision`,
            {
              method: 'POST',
              body: {
                propertyId: config.propertyId,
                operation: 'approve',
                reason:
                  'Independent reviewer approved the exact Aurora rollback baseline captured for this test lifecycle.',
              },
            }
          )
          expectApiOk(
            decision,
            `Approve Aurora rollback baseline ${baseline.id}`
          )
        }
        importResponse = await callAuroraMutation(
          page,
          config,
          config.importUrl,
          { method: 'POST', body: importBody }
        )
      }
      expectApiOk(importResponse, 'Import Aurora immutable rollback baseline')
      const importedArtifacts = importResponse.data as {
        currentArtifact: { id: string; contentHash: string }
        rollbackBaseline: { id: string; contentHash: string }
      }
      config.startArtifactId = importedArtifacts.currentArtifact.id
      config.startContentHash = importedArtifacts.currentArtifact.contentHash
      config.rollbackArtifactId = importedArtifacts.rollbackBaseline.id
      config.rollbackContentHash =
        importedArtifacts.rollbackBaseline.contentHash

      const provisionResponse = await callAuroraMutation(
        page,
        config,
        config.resourcesUrl,
        {
          method: 'POST',
          body:
            config.stagingApplicationId && config.stagingOperationId
              ? {
                  operation: 'provision_verified_targets',
                  propertyId: config.propertyId,
                  websiteId: config.websiteId,
                  stagingApplicationId: config.stagingApplicationId,
                  stagingOperationId: config.stagingOperationId,
                }
              : {
                  operation: 'create_and_provision_verified_targets',
                  propertyId: config.propertyId,
                  websiteId: config.websiteId,
                },
        }
      )
      expectApiOk(
        provisionResponse,
        'Register exact verified Aurora Cloudways targets'
      )
      const provisionedTargets = provisionResponse.data as {
        stagingApplicationId?: string
        stagingOperationId?: string
      }
      config.stagingApplicationId =
        provisionedTargets.stagingApplicationId || config.stagingApplicationId
      config.stagingOperationId =
        provisionedTargets.stagingOperationId || config.stagingOperationId
      expect(config.stagingApplicationId).toBeTruthy()
      expect(config.stagingOperationId).toBeTruthy()

      const backupStart = await callAuroraMutation(
        page,
        config,
        config.providerOperationsUrl,
        {
          method: 'POST',
          body: {
            operation: 'start_backup',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
          },
        }
      )
      expectApiOk(backupStart, 'Start owned Aurora bootstrap backup')
      const backupIdentity = backupStart.data as {
        operationId: string
        backupId: string
      }
      config.backupOperationId = backupIdentity.operationId
      config.backupId = backupIdentity.backupId
      const backupPoll = await callAuroraMutation(
        page,
        config,
        config.providerOperationsUrl,
        {
          method: 'POST',
          body: {
            operation: 'poll_backup',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
          },
        }
      )
      expectApiOk(backupPoll, 'Verify owned Aurora bootstrap backup')

      const activation = await callAuroraMutation(
        page,
        config,
        config.leaseUrl,
        {
          method: 'POST',
          body: {
            operation: 'activate_mutation',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            targetId: config.targetId,
            rolloutAssignmentId: config.rolloutAssignmentId,
            ownerId: config.ownerId,
            expiresAt: config.expiresAt,
          },
        }
      )
      expectApiOk(activation, 'Activate verified Aurora mutation lease')

      const imported = await loadAuroraResources(page, config)
      expect(imported.identity).toMatchObject({
        propertyId: config.propertyId,
        websiteId: config.websiteId,
        targetId: config.targetId,
        rolloutAssignmentId: config.rolloutAssignmentId,
      })
      expect(imported.currentArtifact).toMatchObject({
        id: config.startArtifactId,
        contentHash: config.startContentHash,
        runtimeContractVersion: 3,
        runtimePackageSha256: config.runtimePackageSha256,
        runtimeManifestSha256: config.runtimeManifestSha256,
        baseThemePackageSha256: config.baseThemePackageSha256,
      })
      expect(imported.rollbackArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: config.rollbackArtifactId,
            contentHash: config.rollbackContentHash,
            immutable: true,
            remoteVerified: true,
          }),
        ])
      )

      const editor = await openAuroraEditorSession(page, config)
      expect(editor.artifact).toEqual({
        id: config.startArtifactId,
        contentHash: config.startContentHash,
      })
      let artifact: AuroraArtifact = editor.artifact
      const editIntents = [
        'Copy: revise the homepage hero and supporting copy using only approved property facts and knowledge evidence.',
        'Topology: add a clearly named amenities page and preserve all existing required pages.',
        'Navigation and footer: expose the amenities page in both global navigation and footer without removing legal links.',
        'Forms: improve the contact and tour forms while preserving verified destinations, labels, validation, and consent.',
        'SEO and redirects: add exact canonical metadata, Open Graph fields, JSON-LD, sitemap coverage, and a loop-free redirect for the prior amenities path.',
        'Media: use only approved governed property media, preserve rights metadata, alt text, dimensions, and immutable asset identities.',
        'Knowledge: add a concise neighborhood section derived only from approved knowledge sources and cite the source identities in the artifact.',
        'Responsive: improve tablet and mobile layout without horizontal overflow or changing approved content.',
        'Accessibility: improve landmarks, heading order, labels, keyboard order, visible focus, contrast, and reduced-motion behavior.',
      ]
      const consecutiveArtifacts: string[] = []
      for (const intent of editIntents) {
        const prior = artifact
        artifact = await submitAuroraSemanticEdit(
          page,
          config,
          editor.sessionId,
          prior,
          intent
        )
        expect(artifact.id).not.toBe(prior.id)
        expect(artifact.contentHash).not.toBe(prior.contentHash)
        consecutiveArtifacts.push(artifact.id)
      }
      expect(new Set(consecutiveArtifacts).size).toBe(editIntents.length)

      artifact = await submitAuroraSemanticEdit(
        page,
        config,
        editor.sessionId,
        artifact,
        'Custom interaction: propose a governed extension for an accessible floor-plan comparison control; do not emulate it with unsupported semantic operations.'
      )
      const firstExtensionResources = await waitForAuroraResources(
        page,
        config,
        resources =>
          Boolean(
            resources.extensionRequests?.some(item => item.status === 'proposed')
          ),
        'first custom interaction extension request'
      )
      const deniedExtension = firstExtensionResources.extensionRequests?.find(
        item => item.status === 'proposed'
      )
      expect(deniedExtension?.id).toBeTruthy()
      const denyResponse = await callAuroraMutation(
        reviewerPage,
        config,
        `/api/siteforge/extensions/${deniedExtension?.id}/decision`,
        {
          method: 'POST',
          body: {
            decision: 'rejected',
            reason:
              'Independent reviewer denies the first custom interaction package to prove fail-closed extension review.',
          },
        }
      )
      expectApiOk(denyResponse, 'Deny Aurora runtime extension')

      artifact = (await openAuroraEditorSession(page, config)).artifact
      artifact = await submitAuroraSemanticEdit(
        page,
        config,
        editor.sessionId,
        artifact,
        'Custom interaction: propose a new governed extension for an accessible, keyboard-operable floor-plan comparison control with exact package and validation evidence.'
      )
      const secondExtensionResources = await waitForAuroraResources(
        page,
        config,
        resources =>
          Boolean(
            resources.extensionRequests?.some(
              item =>
                item.status === 'proposed' && item.id !== deniedExtension?.id
            )
          ),
        'second custom interaction extension request'
      )
      const approvedExtension = secondExtensionResources.extensionRequests?.find(
        item => item.status === 'proposed' && item.id !== deniedExtension?.id
      )
      expect(approvedExtension?.id).toBeTruthy()
      const approveExtensionResponse = await callAuroraMutation(
        reviewerPage,
        config,
        `/api/siteforge/extensions/${approvedExtension?.id}/decision`,
        {
          method: 'POST',
          body: {
            decision: 'approved',
            reason:
              'Independent reviewer verified the exact extension package, responsive behavior, keyboard behavior, and sandbox report.',
          },
        }
      )
      expectApiOk(approveExtensionResponse, 'Approve Aurora runtime extension')
      artifact = (await openAuroraEditorSession(page, config)).artifact
      expect(artifact.id).not.toBe(approvedExtension?.artifactId)
      const semanticEvidence = await loadAuroraResources(page, config)
      expect(semanticEvidence.semanticCoverage).toEqual({
        copy: true,
        topology: true,
        navigation: true,
        footer: true,
        forms: true,
        seo: true,
        redirects: true,
        media: true,
        knowledge: true,
        responsive: true,
        accessibility: true,
        customInteraction: true,
      })
      expect(semanticEvidence.artifactLineage).toEqual(
        expect.arrayContaining(consecutiveArtifacts)
      )
      expect(semanticEvidence.mutationLeaseViolations || []).toEqual([])

      const firstPreview = await runCanonicalPreview(
        page,
        config,
        artifact
      )
      expect(
        firstPreview.status,
        `First-use preview must stop after creating baseline candidates: ${JSON.stringify(firstPreview)}`
      ).toBe('failed')
      const candidateResources = await waitForAuroraResources(
        page,
        config,
        resources =>
          Boolean(
            resources.baselineCandidates?.length &&
              resources.baselineCandidates.every(
                item =>
                  item.status === 'candidate' &&
                  item.artifactId === artifact.id
              )
          ),
        'policy-v4 visual baseline candidates'
      )
      for (const baseline of candidateResources.baselineCandidates || []) {
        const baselineDecision = await callAuroraMutation(
          reviewerPage,
          config,
          `/api/siteforge/certification/baselines/${baseline.id}/decision`,
          {
            method: 'POST',
            body: {
              propertyId: config.propertyId,
              operation: 'approve',
              reason:
                'Independent reviewer approved the exact Aurora policy-v4 page and viewport screenshot identity.',
            },
          }
        )
        expectApiOk(
          baselineDecision,
          `Approve Aurora visual baseline ${baseline.id}`
        )
      }

      const exactPreview = await runCanonicalPreview(
        page,
        config,
        artifact,
        true
      )
      expect(exactPreview.status).toBe('succeeded')
      const previewResponse = await callAuthedApi(
        page,
        `/api/siteforge/preview/${config.websiteId}`
      )
      expectApiOk(previewResponse, 'Load Aurora exact preview identity')
      const previewArtifact = (previewResponse.data as {
        artifact?: {
          canonicalPreviewArtifactId?: string
          canonicalPreviewContentHash?: string
          canonicalPreviewUrl?: string
        }
      }).artifact
      expect(previewArtifact).toMatchObject({
        canonicalPreviewArtifactId: artifact.id,
        canonicalPreviewContentHash: artifact.contentHash,
      })
      expect(previewArtifact?.canonicalPreviewUrl).toMatch(/^https:\/\//)

      const certifiedPreview = await waitForAuroraResources(
        page,
        config,
        resources =>
          Boolean(
            resources.certifications?.some(
              item =>
                item.artifactId === artifact.id &&
                item.environment === 'preview' &&
                item.access === 'protected' &&
                item.status === 'passed' &&
                item.policyVersion ===
                  SITEFORGE_CERTIFICATION_POLICY_VERSION
            )
          ),
        'policy-v4 protected preview certification'
      )
      expect(
        certifiedPreview.certifications?.some(
          item =>
            item.artifactId === artifact.id &&
            item.environment === 'preview' &&
            item.access === 'protected' &&
            item.status === 'passed'
        )
      ).toBe(true)

      const artifactApproval = await callAuroraMutation(
        reviewerPage,
        config,
        `/api/siteforge/artifacts/${artifact.id}/decision`,
        {
          method: 'POST',
          body: {
            propertyId: config.propertyId,
            contentHash: artifact.contentHash,
            decisionStatus: 'approved',
            decisionReason:
              'Independent reviewer approved the exact policy-v4 certified Aurora preview for v3 staging.',
          },
        }
      )
      expectApiOk(artifactApproval, 'Approve exact Aurora artifact')

      const deployResponse = await callAuroraMutation(
        page,
        config,
        `/api/siteforge/deploy/${config.websiteId}`,
        { method: 'POST' }
      )
      expectApiOk(deployResponse, 'Deploy Aurora runtime v3 staging')
      const stagingResources = await waitForAuroraResources(
        page,
        config,
        resources =>
          Boolean(
            resources.certifications?.some(
              item =>
                item.artifactId === artifact.id &&
                item.environment === 'staging' &&
                item.access === 'public' &&
                item.status === 'passed' &&
                item.policyVersion ===
                  SITEFORGE_CERTIFICATION_POLICY_VERSION
            )
          ),
        'public policy-v4 v3 staging certification',
        1_800_000
      )
      expect(stagingResources.currentArtifact?.runtimeContractVersion).toBe(3)

      const prepareResponse = await callAuroraMutation(
        page,
        config,
        '/api/siteforge/launch/prepare',
        {
          method: 'POST',
          body: {
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            artifactId: artifact.id,
            contentHash: artifact.contentHash,
            rollbackArtifactId: config.rollbackArtifactId,
            rollbackContentHash: config.rollbackContentHash,
          },
        }
      )
      expectApiOk(prepareResponse, 'Prepare Aurora launch release')
      const releaseId = (
        prepareResponse.data as { release?: { id?: string } }
      ).release?.id
      expect(releaseId).toBeTruthy()

      const launchApproval = await callAuroraMutation(
        reviewerPage,
        config,
        '/api/siteforge/launch/approve',
        {
          method: 'POST',
          body: {
            propertyId: config.propertyId,
            releaseId,
            artifactId: artifact.id,
            contentHash: artifact.contentHash,
            rollbackArtifactId: config.rollbackArtifactId,
            rollbackContentHash: config.rollbackContentHash,
            rationale:
              'Independent launch manager approved the exact Aurora v3 release and immutable rollback baseline.',
            legalRightsSnapshot: {
              confirmed: true,
              ownerId: config.ownerId,
              expiresAt: config.expiresAt,
            },
            expiresAt: config.expiresAt,
          },
        }
      )
      expectApiOk(launchApproval, 'Approve Aurora launch release')
      const promotionToken = (
        launchApproval.data as { promotionToken?: string }
      ).promotionToken
      expect(promotionToken).toBeTruthy()

      if (!config.promotionOperationId) {
        const promotionStart = await callAuroraMutation(
          reviewerPage,
          config,
          config.providerOperationsUrl,
          {
            method: 'POST',
            body: {
              operation: 'start_promotion',
              propertyId: config.propertyId,
              websiteId: config.websiteId,
              releaseId,
            },
          }
        )
        expectApiOk(
          promotionStart,
          'Perform exact owned Aurora Cloudways promotion'
        )
        config.promotionOperationId = (
          promotionStart.data as { operationId?: string }
        ).operationId || ''
      }
      expect(config.promotionOperationId).toBeTruthy()

      const promotion = await callAuroraMutation(
        reviewerPage,
        config,
        '/api/siteforge/launch/promote',
        {
          method: 'POST',
          body: {
            propertyId: config.propertyId,
            releaseId,
            promotionToken,
            backupConfirmation: {
              operationId: config.backupOperationId,
              backupId: config.backupId,
            },
            manualConfirmation: {
              operationId: config.promotionOperationId,
            },
          },
        }
      )
      expectApiOk(promotion, 'Promote Aurora production release')
      const promotionVerification = await callAuroraMutation(
        reviewerPage,
        config,
        config.providerOperationsUrl,
        {
          method: 'POST',
          body: {
            operation: 'verify_promotion',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            releaseId,
          },
        }
      )
      expectApiOk(
        promotionVerification,
        'Verify persisted Aurora Cloudways promotion operation'
      )

      const productionCertification = await callAuroraMutation(
        reviewerPage,
        config,
        `/api/siteforge/production/${config.websiteId}/certify`,
        {
          method: 'POST',
          body: {
            releaseId,
            promotedArtifactId: artifact.id,
            promotedContentHash: artifact.contentHash,
          },
        }
      )
      expectApiOk(
        productionCertification,
        'Start Aurora production certification'
      )
      await waitForAuroraResources(
        page,
        config,
        resources =>
          Boolean(
            resources.certifications?.some(
              item =>
                item.artifactId === artifact.id &&
                item.environment === 'production' &&
                item.access === 'public' &&
                item.status === 'passed' &&
                item.policyVersion ===
                  SITEFORGE_CERTIFICATION_POLICY_VERSION
            ) &&
              resources.releases?.some(
                item =>
                  item.id === releaseId &&
                  ['production_certified', 'live'].includes(item.state || '')
              )
          ),
        'public policy-v4 production certification',
        1_800_000
      )

      const rollbackPreview = await callAuthedApi(
        page,
        `/api/siteforge/rollback/${config.websiteId}`
      )
      expectApiOk(rollbackPreview, 'Load Aurora immutable rollback history')
      expect(rollbackPreview.data).toMatchObject({
        canRollback: true,
        currentArtifact: { id: artifact.id },
        rollbackToArtifactId: config.rollbackArtifactId,
        rollbackToContentHash: config.rollbackContentHash,
      })
      const rollback = await callAuroraMutation(
        reviewerPage,
        config,
        `/api/siteforge/rollback/${config.websiteId}`,
        {
          method: 'POST',
          body: {
            expectedCurrentArtifactId: artifact.id,
            targetArtifactId: config.rollbackArtifactId,
            targetContentHash: config.rollbackContentHash,
            decisionReason:
              'Independent reviewer creates an immutable rollback revision from the imported, remotely verified Aurora baseline.',
          },
        }
      )
      expectApiOk(rollback, 'Create Aurora immutable rollback revision')
      expect(rollback.data).toMatchObject({
        rolledBackFromArtifactId: artifact.id,
        rolledBackToArtifactId: config.rollbackArtifactId,
        requiresCanonicalPreview: true,
        requiresDeploymentApproval: true,
      })

      const restoreRequest = await callAuroraMutation(
        reviewerPage,
        config,
        '/api/siteforge/launch/restore',
        {
          method: 'POST',
          body: {
            propertyId: config.propertyId,
            releaseId,
            rationale:
              'Supervised Aurora restore returns the disposable production target to the imported immutable baseline.',
          },
        }
      )
      expectApiOk(restoreRequest, 'Request supervised Aurora restore')
      expect(restoreRequest.data).toMatchObject({ manualRequired: true })

      const restoreStart = await callAuroraMutation(
        reviewerPage,
        config,
        config.providerOperationsUrl,
        {
          method: 'POST',
          body: {
            operation: 'start_restore',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            releaseId,
          },
        }
      )
      expectApiOk(restoreStart, 'Start owned Aurora Cloudways restore')
      config.restoreOperationId = (
        restoreStart.data as { operationId: string }
      ).operationId
      const restoreVerification = await callAuroraMutation(
        reviewerPage,
        config,
        config.providerOperationsUrl,
        {
          method: 'POST',
          body: {
            operation: 'poll_restore',
            propertyId: config.propertyId,
            websiteId: config.websiteId,
            releaseId,
          },
        }
      )
      expectApiOk(
        restoreVerification,
        'Verify exact Aurora Cloudways restore operation'
      )

      const restore = await callAuroraMutation(
        reviewerPage,
        config,
        '/api/siteforge/launch/restore',
        {
          method: 'POST',
          body: {
            propertyId: config.propertyId,
            releaseId,
            rationale:
              'Supervised Aurora restore returns the disposable production target to the imported immutable baseline.',
            manualConfirmation: {
              operationId: config.restoreOperationId,
            },
          },
        }
      )
      expectApiOk(restore, 'Complete supervised Aurora restore')
      expect(restore.data).toMatchObject({ manualRequired: false })
    } catch (error) {
      primaryError = error
      throw error
    } finally {
      try {
        const cleanup = await callAuroraMutation(
          page,
          config,
          config.cleanupUrl,
          {
            method: 'DELETE',
            body: {
              propertyId: config.propertyId,
              websiteId: config.websiteId,
              targetId: config.targetId,
              ownerId: config.ownerId,
              expiresAt: config.expiresAt,
              confirmation: 'DELETE_OWNED_AURORA_RESOURCES',
            },
          }
        )
        expectApiOk(cleanup, 'Clean up owned Aurora lifecycle resources')
        const verification = await loadAuroraResources(page, config)
        expect(verification.cleanup).toEqual({
          verified: true,
          remainingOwnedResourceIds: [],
        })
        expect(verification.ownedResourceIds || []).toEqual([])
        expect(verification.mutationLeaseViolations || []).toEqual([])
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError
        console.error('Aurora cleanup also failed after lifecycle failure', {
          message:
            cleanupError instanceof Error
              ? cleanupError.message
              : 'unknown cleanup failure',
        })
      } finally {
        await reviewerContext.close()
      }
    }
  })
})

test.describe('local smoke flows', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/')

    await page.waitForURL('**/auth/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('seeded local user can sign in and reach an authenticated app route', async ({ page }) => {
    await login(page)
    const dashboardHeading = page.getByRole('heading', { name: 'Overview' })
    const onboardingHeading = page.getByRole('heading', { name: 'Welcome to P11 Platform' })

    await expect(dashboardHeading.or(onboardingHeading)).toBeVisible()

    if (await dashboardHeading.isVisible()) {
      await expect(page.getByText('Performance summary for P11 Local Demo Property')).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: 'Welcome to P11 Platform' })).toBeVisible()
      await expect(page.getByLabel('Organization name *')).toBeVisible()
    }
  })

  test('community setup plus knowledge ingestion and retrieval stays deterministic locally', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)

    const sourceName = `P11 Local Smoke Knowledge Source (${propertyId.slice(0, 8)})`
    const sourceUrl = `https://local-smoke.p11.test/${propertyId}`

    const ingestResponse = await callAuthedApi(page, '/api/community/knowledge-sources', {
      method: 'POST',
      body: {
        propertyId,
        sourceType: 'manual',
        sourceName,
        sourceUrl,
        extractedData: {
          amenities: ['Smoke Test Rooftop Lounge', 'Smoke Test Fitness Studio'],
          specials: ['Smoke Test Move-in Special'],
          brand_origin: 'client_provided_material',
          deterministic_marker: 'local_smoke_setup_ingest_retrieve',
        },
      },
    })
    expect(ingestResponse.ok, `Knowledge source ingest failed: ${JSON.stringify(ingestResponse)}`).toBe(
      true
    )

    const retrievalResponse = await callAuthedApi(
      page,
      `/api/community/knowledge-sources?propertyId=${propertyId}`
    )
    expect(
      retrievalResponse.ok,
      `Knowledge source retrieval failed: ${JSON.stringify(retrievalResponse)}`
    ).toBe(true)

    const retrievalData = retrievalResponse.data as {
      sources?: Array<{ source_name?: string; source_url?: string }>
      insights?: string[]
      categories?: Record<string, number>
      documentsCount?: number
    }
    const sources = Array.isArray(retrievalData.sources) ? retrievalData.sources : []
    const insights = Array.isArray(retrievalData.insights) ? retrievalData.insights : []

    const smokeSource = sources.find(
      source => source.source_name === sourceName && source.source_url === sourceUrl
    )
    expect(smokeSource).toBeTruthy()
    expect(insights.some(insight => insight.includes('Amenities:'))).toBe(true)
    expect(typeof retrievalData.documentsCount).toBe('number')
    expect(typeof retrievalData.categories).toBe('object')
  })

  test('marketvision competitor ingest to analysis insight generation stays deterministic locally', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    const suffix = Date.now().toString(36)
    const competitorName = `Local Smoke Competitor ${suffix}`

    const createCompetitorResponse = await callAuthedApi(page, '/api/marketvision/competitors', {
      method: 'POST',
      body: {
        propertyId,
        name: competitorName,
        address: '100 Local Smoke Way, Austin, TX',
        websiteUrl: `https://competitor-${suffix}.p11.test`,
        propertyType: 'multifamily',
        amenities: ['Rooftop pool', 'Coworking lounge'],
        units: [
          {
            unitType: 'A1',
            bedrooms: 1,
            bathrooms: 1,
            sqftMin: 650,
            sqftMax: 700,
            rentMin: 1700,
            rentMax: 1850,
            availableCount: 3,
          },
          {
            unitType: 'B2',
            bedrooms: 2,
            bathrooms: 2,
            sqftMin: 980,
            sqftMax: 1100,
            rentMin: 2300,
            rentMax: 2500,
            availableCount: 2,
          },
        ],
      },
    })
    expect(
      createCompetitorResponse.ok,
      `Competitor ingest failed: ${JSON.stringify(createCompetitorResponse)}`
    ).toBeTruthy()
    const createData = createCompetitorResponse.data as {
      competitor?: { id?: string; name?: string; propertyId?: string }
    }
    const competitorId = createData.competitor?.id
    expect(typeof competitorId).toBe('string')
    expect(createData.competitor?.name).toBe(competitorName)
    expect(createData.competitor?.propertyId).toBe(propertyId)

    const comparisonResponse = await callAuthedApi(
      page,
      `/api/marketvision/analysis?propertyId=${propertyId}&type=comparison&bedrooms=1`
    )
    expect(
      comparisonResponse.ok,
      `Comparison insight generation failed: ${JSON.stringify(comparisonResponse)}`
    ).toBeTruthy()
    const comparisonData = comparisonResponse.data as {
      comparisons?: Array<{
        competitor?: { id?: string; name?: string }
        avgRent?: number
        units?: Array<{ bedrooms?: number; rentMin?: number | null; availableCount?: number }>
      }>
    }
    const competitorComparison = (comparisonData.comparisons || []).find(
      entry => entry.competitor?.id === competitorId
    )
    expect(competitorComparison).toBeTruthy()
    expect(competitorComparison?.competitor?.name).toBe(competitorName)
    expect((competitorComparison?.avgRent || 0) > 0).toBe(true)
    expect((competitorComparison?.units || []).some(unit => unit.bedrooms === 1)).toBe(true)

    const summaryResponse = await callAuthedApi(
      page,
      `/api/marketvision/analysis?propertyId=${propertyId}&type=summary`
    )
    expect(summaryResponse.ok, `Summary insight generation failed: ${JSON.stringify(summaryResponse)}`).toBeTruthy()
    const summaryData = summaryResponse.data as {
      summary?: {
        competitorCount?: number
        totalUnitsTracked?: number
        avgRentByBedroom?: Record<string, { avg?: number }>
      }
    }
    expect((summaryData.summary?.competitorCount || 0) > 0).toBe(true)
    expect((summaryData.summary?.totalUnitsTracked || 0) > 0).toBe(true)
    expect((summaryData.summary?.avgRentByBedroom?.['1BR']?.avg || 0) > 0).toBe(true)

    const cleanupResponse = await callAuthedApi(
      page,
      `/api/marketvision/competitors?id=${competitorId as string}`,
      { method: 'DELETE' }
    )
    expect(cleanupResponse.ok, `Competitor cleanup failed: ${JSON.stringify(cleanupResponse)}`).toBeTruthy()
  })

  test('multichannel bi connection import reporting and recurring sync stays deterministic locally', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    const suffix = Date.now().toString(36)
    const accountId = `local-smoke-${suffix}`
    const campaignName = `Local Smoke Campaign ${suffix}`
    const today = new Date().toISOString().slice(0, 10)
    let connectionId: string | null = null

    try {
      const createConnectionResponse = await callAuthedApi(page, '/api/integrations/ad-connections', {
        method: 'POST',
        body: {
          property_id: propertyId,
          platform: 'google_ads',
          account_id: accountId,
          account_name: `Local Smoke Account ${suffix}`,
        },
      })
      expect(
        createConnectionResponse.ok,
        `Ad connection create failed: ${JSON.stringify(createConnectionResponse)}`
      ).toBeTruthy()
      const createConnectionData = createConnectionResponse.data as {
        connection?: { id?: string; property_id?: string; platform?: string; account_id?: string }
      }
      connectionId = typeof createConnectionData.connection?.id === 'string' ? createConnectionData.connection.id : null
      expect(connectionId).toBeTruthy()
      expect(createConnectionData.connection?.property_id).toBe(propertyId)
      expect(createConnectionData.connection?.platform).toBe('google_ads')
      expect(createConnectionData.connection?.account_id).toBe(accountId)

      const csvContent = [
        'Date,Impressions,Clicks,Cost,Conversions',
        `${today},1200,64,$145.50,7`,
      ].join('\n')

      const importResponse = await callAuthedApi(page, '/api/analytics/upload', {
        method: 'POST',
        body: {
          csvContent,
          filename: `local_smoke_${today}.csv`,
          campaignName,
          propertyId,
          platform: 'google_ads',
          preview: false,
        },
      })
      expect(importResponse.ok, `CSV import failed: ${JSON.stringify(importResponse)}`).toBeTruthy()
      const importData = importResponse.data as {
        success?: boolean
        imported?: { rowCount?: number; reportType?: string }
      }
      expect(importData.success).toBe(true)
      expect((importData.imported?.rowCount || 0) > 0).toBe(true)
      expect(importData.imported?.reportType).toBe('time_series')

      const performanceResponse = await callAuthedApi(
        page,
        `/api/analytics/performance?propertyId=${propertyId}&startDate=${today}&endDate=${today}`
      )
      expect(
        performanceResponse.ok,
        `Performance reporting failed: ${JSON.stringify(performanceResponse)}`
      ).toBeTruthy()
      const performanceData = performanceResponse.data as {
        totals?: { spend?: number; clicks?: number; impressions?: number; conversions?: number }
        channels?: Array<{ channel?: string; spend?: number }>
      }
      expect((performanceData.totals?.spend || 0) > 0).toBe(true)
      expect((performanceData.totals?.clicks || 0) > 0).toBe(true)
      expect((performanceData.totals?.impressions || 0) > 0).toBe(true)
      expect((performanceData.totals?.conversions || 0) > 0).toBe(true)
      expect(
        (performanceData.channels || []).some(channel => channel.channel === 'google_ads')
      ).toBe(true)

      const cronHeaders = process.env.CRON_SECRET
        ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
        : undefined
      const recurringSyncResponse = await callAuthedApi(page, '/api/cron/sync-ads', {
        headers: cronHeaders,
      })
      expect(
        recurringSyncResponse.ok,
        `Recurring sync trigger failed: ${JSON.stringify(recurringSyncResponse)}`
      ).toBeTruthy()
      const recurringSyncData = recurringSyncResponse.data as {
        success?: boolean
        totalConnections?: number
        failures?: number
        results?: Array<{ accountId?: string; error?: string }>
        message?: string
        synced?: number
      }
      if (typeof recurringSyncData.success === 'boolean') {
        expect(recurringSyncData.success).toBe(true)
        expect((recurringSyncData.totalConnections || 0) > 0).toBe(true)
        const accountResult = (recurringSyncData.results || []).find(result => result.accountId === accountId)
        expect(accountResult).toBeTruthy()
        if (process.env.GOOGLE_ADS_CLIENT_ID) {
          expect(accountResult?.error || null).toBeNull()
        } else {
          expect(typeof accountResult?.error).toBe('string')
          expect((accountResult?.error || '').toLowerCase()).toContain('not configured')
        }
      } else {
        expect(recurringSyncData.message).toBe('No connections to sync')
        expect(typeof recurringSyncData.synced).toBe('number')
      }
    } finally {
      if (connectionId) {
        const deleteConnectionResponse = await callAuthedApi(
          page,
          `/api/integrations/ad-connections?id=${connectionId}`,
          { method: 'DELETE' }
        )
        expect(
          deleteConnectionResponse.ok,
          `Ad connection cleanup failed: ${JSON.stringify(deleteConnectionResponse)}`
        ).toBeTruthy()
      }
    }
  })

  test('siteforge confirmed plan produces an immutable artifact before staging', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)

    const generation = await createApprovedSiteForgeGeneration(
      page,
      propertyId,
      'Smoke test immutable generated version'
    )

    const generationStatus = await waitForWebsiteStatus(
      page,
      generation.websiteId,
      ['ready_for_preview', 'complete', 'failed'],
      180_000
    )
    expect(
      generationStatus.status === 'ready_for_preview' || generationStatus.status === 'complete',
      `Generation did not reach ready state: ${JSON.stringify(generationStatus)}`
    ).toBe(true)

    const deployResponse = await callAuthedApi(
      page,
      `/api/siteforge/deploy/${generation.websiteId}?simulate=1`,
      { method: 'POST' }
    )
    expect(deployResponse.status).toBe(409)
    expect(
      String((deployResponse.data as Record<string, unknown>)?.error || '')
    ).toContain('Approve an exact')

    const artifactResponse = await callAuthedApi(
      page,
      `/api/siteforge/rollback/${generation.websiteId}`
    )
    expect(
      artifactResponse.ok,
      `Immutable artifact lookup failed: ${JSON.stringify(artifactResponse)}`
    ).toBeTruthy()
    const artifactData = artifactResponse.data as Record<string, unknown>
    const currentArtifact = artifactData.currentArtifact as
      | { id?: string; version?: number; content_hash?: string }
      | undefined
    expect(typeof currentArtifact?.id).toBe('string')
    expect(typeof currentArtifact?.version).toBe('number')
    expect(currentArtifact?.content_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(artifactData.canRollback).toBe(false)
    expect(artifactData.history).toEqual([])
  })

  test('siteforge semantic editor opens one-window chat and staging workspace', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    test.skip(
      process.env.SITEFORGE_SEMANTIC_EDITOR_ENABLED !== 'true',
      'Set SITEFORGE_SEMANTIC_EDITOR_ENABLED=true to run the semantic editor smoke.'
    )
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    const generated = await createApprovedSiteForgeGeneration(
      page,
      propertyId,
      'Semantic editor local smoke website'
    )
    const websiteId = generated.websiteId
    await waitForWebsiteStatus(
      page,
      websiteId,
      ['ready_for_preview', 'failed'],
      120_000
    )

    await page.goto(`/dashboard/siteforge/${websiteId}`)
    await expect(
      page.getByText(/Production promotion requires a separate, expiring manager launch approval/)
    ).toBeVisible()
    await expect(
      page.getByPlaceholder(/Describe any site-wide change/i)
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Deploy to staging' })
    ).toBeVisible()
    await expect(page.getByText('Human launch gate enforced')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Prepare launch release' })
    ).toBeVisible()
    await expect(
      page.getByLabel('Production operation rationale')
    ).toBeVisible()

    if (process.env.SITEFORGE_RUNTIME_V2_SMOKE !== '1') return

    await page.getByRole('button', { name: 'WordPress preview' }).click()
    await page.getByRole('button', { name: 'Render exact revision' }).click()
    await expect(
      page.getByTitle('Exact WordPress preview')
    ).toBeVisible({ timeout: 120_000 })

    await page
      .getByLabel('Site edit request')
      .fill(
        'Change only the homepage hero heading to "Runtime v2 exact edit smoke". Preserve every color, font, spacing value, asset, and layout.'
      )
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByRole('button', { name: 'Working…' })).toBeHidden({
      timeout: 120_000,
    })
    await expect(
      page.getByTitle('Exact WordPress preview')
    ).toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('WordPress preview stale')).toBeVisible({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: 'Render exact revision' }).click()
    await expect(
      page.getByTitle('Exact WordPress preview')
    ).toBeVisible({ timeout: 120_000 })
  })

  test('seeded LumaLeasing tour availability returns local fixture slots', async ({ request }) => {
    const response = await request.get('/api/lumaleasing/tours', {
      headers: {
        'X-API-Key': 'local-luma-demo-key',
      },
      params: {
        startDate: '2099-01-01',
        endDate: '2099-01-31',
      },
    })

    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.tourDuration).toBe(30)
    expect(data.slots['2099-01-15']).toBeTruthy()
    expect(data.slots['2099-01-15'][0]).toMatchObject({
      id: '99999999-9999-9999-9999-999999999999',
      date: '2099-01-15',
      startTime: '10:00:00',
      endTime: '10:30:00',
      available: 3,
    })
  })

  test('lumaleasing provider-backed status and booking flow (opt-in)', async ({ page, request }) => {
    test.setTimeout(300_000)
    test.skip(
      process.env.LUMALEASING_REAL_SMOKE !== '1',
      'Set LUMALEASING_REAL_SMOKE=1 to run real LumaLeasing provider smoke.'
    )

    const apiKey = process.env.LUMALEASING_REAL_SMOKE_API_KEY
    test.skip(!apiKey, 'Set LUMALEASING_REAL_SMOKE_API_KEY to run real LumaLeasing provider smoke.')
    if (!apiKey) return

    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(
      page,
      'LUMALEASING_REAL_SMOKE_PROPERTY_ID'
    )

    const calendarStatus = await callAuthedApi(
      page,
      `/api/lumaleasing/calendar/status?propertyId=${propertyId}`
    )
    expect(calendarStatus.ok, `Calendar status failed: ${JSON.stringify(calendarStatus)}`).toBeTruthy()
    const calendarData = calendarStatus.data as {
      connected?: boolean
      token_status?: string
      calendar_sync?: { degraded?: boolean }
    }
    expect(calendarData.connected).toBe(true)
    expect(calendarData.token_status).toBe('healthy')
    expect(calendarData.calendar_sync?.degraded).not.toBe(true)

    const emailStatus = await callAuthedApi(page, `/api/lumaleasing/email/status?propertyId=${propertyId}`)
    expect(emailStatus.ok, `Email status failed: ${JSON.stringify(emailStatus)}`).toBeTruthy()
    const emailData = emailStatus.data as {
      connected?: boolean
      token_status?: string
    }
    expect(emailData.connected).toBe(true)
    expect(emailData.token_status).toBe('healthy')

    const now = new Date()
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const availabilityResponse = await request.get('/api/lumaleasing/tours', {
      headers: {
        'X-API-Key': apiKey,
      },
      params: {
        startDate,
        endDate,
      },
    })
    expect(availabilityResponse.ok()).toBeTruthy()

    const availabilityData = (await availabilityResponse.json()) as {
      slots?: Record<
        string,
        Array<{ id: string; date: string; startTime: string; endTime: string; available: number }>
      >
    }
    const dayEntries = Object.entries(availabilityData.slots || {})
    const firstDayWithSlots = dayEntries.find(([, slots]) => Array.isArray(slots) && slots.length > 0)
    expect(firstDayWithSlots, `No available slots returned: ${JSON.stringify(availabilityData)}`).toBeTruthy()
    const firstSlot = firstDayWithSlots?.[1]?.[0]
    expect(firstSlot).toBeTruthy()

    const uniqueLeadSuffix = Date.now().toString(36)
    const bookingResponse = await request.post('/api/lumaleasing/tours', {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      data: {
        slotId: firstSlot?.id,
        leadInfo: {
          firstName: 'Provider',
          lastName: 'Smoke',
          email: `provider-smoke-${uniqueLeadSuffix}@p11.test`,
          phone: '5551112222',
        },
      },
    })
    expect(bookingResponse.ok(), `Booking failed: ${await bookingResponse.text()}`).toBeTruthy()
    const bookingData = (await bookingResponse.json()) as {
      success?: boolean
      booking?: { id?: string; status?: string }
      calendar?: { google?: string; icsDownload?: string }
    }
    expect(bookingData.success).toBe(true)
    expect(typeof bookingData.booking?.id).toBe('string')
    expect(bookingData.booking?.status).toBe('confirmed')
    expect(typeof bookingData.calendar?.google).toBe('string')
    expect(typeof bookingData.calendar?.icsDownload).toBe('string')

    // Public widget config — exactly what `lumaleasing.js` fetches first.
    const configResponse = await request.get('/api/lumaleasing/config', {
      headers: { 'X-API-Key': apiKey },
    })
    expect(
      configResponse.ok(),
      `Widget config failed: ${await configResponse.text()}`
    ).toBeTruthy()
    const configData = (await configResponse.json()) as {
      config?: {
        widgetName?: string
        primaryColor?: string
        propertyName?: string
        toursEnabled?: boolean
      }
      isOnline?: boolean
    }
    expect(typeof configData.config?.widgetName).toBe('string')
    expect(typeof configData.config?.primaryColor).toBe('string')

    // Public widget chat — proves OpenAI + RAG + session + conversation
    // pipeline are wired end to end with the property's API key.
    const chatVisitorId = `provider-smoke-visitor-${uniqueLeadSuffix}`
    const chatResponse = await request.post('/api/lumaleasing/chat', {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Visitor-ID': chatVisitorId,
      },
      data: {
        messages: [
          { role: 'user', content: 'Hi! What floor plans do you offer?' },
        ],
      },
    })
    expect(
      chatResponse.ok(),
      `Widget chat failed: ${await chatResponse.text()}`
    ).toBeTruthy()
    const chatData = (await chatResponse.json()) as {
      content?: string
      sessionId?: string
      conversationId?: string | null
    }
    expect(typeof chatData.sessionId).toBe('string')
    expect(typeof chatData.content).toBe('string')
    expect((chatData.content || '').length).toBeGreaterThan(0)

    // Public widget lead capture — must succeed without an authenticated user
    // and must round-trip the lead through the same downstream side effects
    // chat extraction triggers (CRM sync, workflow start).
    const leadResponse = await request.post('/api/lumaleasing/lead', {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Visitor-ID': chatVisitorId,
      },
      data: {
        leadInfo: {
          firstName: 'Provider',
          lastName: 'Smoke',
          email: `provider-smoke-lead-${uniqueLeadSuffix}@p11.test`,
          phone: '5551113333',
        },
        sessionId: chatData.sessionId,
        conversationId: chatData.conversationId ?? undefined,
      },
    })
    expect(
      leadResponse.ok(),
      `Widget lead capture failed: ${await leadResponse.text()}`
    ).toBeTruthy()
    const leadData = (await leadResponse.json()) as {
      success?: boolean
      leadId?: string
    }
    expect(leadData.success).toBe(true)
    expect(typeof leadData.leadId).toBe('string')
  })

  test('propertyaudit deterministic local happy path run to report to export is repeatable', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    await ensurePropertyAuditQueries(page, propertyId)

    const purgeResponse = await callAuthedApi(page, '/api/propertyaudit/runs/purge', {
      method: 'POST',
      body: { propertyId, surfaces: ['openai'] },
    })
    expect(purgeResponse.ok, `PropertyAudit purge failed: ${JSON.stringify(purgeResponse)}`).toBeTruthy()

    const runResponse = await callAuthedApi(page, '/api/propertyaudit/run', {
      method: 'POST',
      body: {
        propertyId,
        surfaces: ['openai'],
        executionCount: 1,
        useLocalFixture: true,
      },
    })
    expect(runResponse.ok, `PropertyAudit run request failed: ${JSON.stringify(runResponse)}`).toBeTruthy()

    const runData = runResponse.data as {
      runs?: Array<{ id?: string; surface?: string }>
      processorMode?: string
    }
    expect(runData.processorMode).toBe('typescript_fixture')
    expect(Array.isArray(runData.runs)).toBe(true)
    expect(runData.runs?.length).toBe(1)
    expect(runData.runs?.[0]?.surface).toBe('openai')

    const runId = runData.runs?.[0]?.id
    expect(typeof runId).toBe('string')

    const completedRun = await waitForPropertyAuditRun(page, runId as string, 120_000)
    expect(
      completedRun.run?.status,
      `PropertyAudit fixture run did not complete successfully: ${JSON.stringify(completedRun)}`
    ).toBe('completed')
    expect(completedRun.run?.errorMessage || null).toBeNull()
    expect(completedRun.score).toBeTruthy()
    expect((completedRun.answers || []).length).toBeGreaterThan(0)

    const reportResponse = await callAuthedTextApi(page, '/api/propertyaudit/generate-report', {
      method: 'POST',
      body: {
        propertyId,
        runId: runId as string,
        template: 'executive',
        includeSections: ['recommendations'],
      },
    })
    expect(
      reportResponse.ok,
      `PropertyAudit report generation failed: ${JSON.stringify(reportResponse)}`
    ).toBeTruthy()
    expect(reportResponse.contentType).toContain('text/html')
    expect(reportResponse.text).toContain('<html')
    expect(reportResponse.text).toContain('GEO Visibility Report')

    const exportResponse = await callAuthedTextApi(
      page,
      `/api/propertyaudit/export?runId=${runId as string}&format=markdown`
    )
    expect(
      exportResponse.ok,
      `PropertyAudit export failed: ${JSON.stringify(exportResponse)}`
    ).toBeTruthy()
    expect(exportResponse.contentType).toContain('text/markdown')
    expect(exportResponse.text).toContain('# GEO Visibility Report')
    expect(exportResponse.text).toContain('**Surface:** OPENAI')
  })

  test('propertyaudit data-engine run reaches completion and supports deterministic report export (opt-in)', async ({
    page,
  }) => {
    const propertyAuditTimeoutMs = Number(process.env.PROPERTYAUDIT_REAL_SMOKE_TIMEOUT_MS || 900_000)
    const requestedSurface = process.env.PROPERTYAUDIT_REAL_SMOKE_SURFACE === 'claude' ? 'claude' : 'openai'

    test.setTimeout(propertyAuditTimeoutMs + 120_000)
    test.skip(
      process.env.PROPERTYAUDIT_REAL_SMOKE !== '1',
      'Set PROPERTYAUDIT_REAL_SMOKE=1 to run the real PropertyAudit data-engine smoke.'
    )

    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(
      page,
      'PROPERTYAUDIT_REAL_SMOKE_PROPERTY_ID'
    )
    await ensurePropertyAuditQueries(page, propertyId)

    const runResponse = await callAuthedApi(page, '/api/propertyaudit/run', {
      method: 'POST',
      body: {
        propertyId,
        surfaces: [requestedSurface],
        executionCount: 1,
      },
    })
    expect(runResponse.ok, `PropertyAudit run request failed: ${JSON.stringify(runResponse)}`).toBeTruthy()

    const runData = runResponse.data as {
      runs?: Array<{ id?: string; surface?: string }>
      processorMode?: string
    }
    expect(runData.processorMode).toBe('data_engine')
    expect(Array.isArray(runData.runs)).toBe(true)
    expect(runData.runs?.length).toBe(1)

    const runId = runData.runs?.[0]?.id
    expect(typeof runId).toBe('string')

    const completedRun = await waitForPropertyAuditRun(page, runId as string, propertyAuditTimeoutMs)
    expect(
      completedRun.run?.status,
      `PropertyAudit run did not complete successfully: ${JSON.stringify(completedRun)}`
    ).toBe('completed')
    expect(completedRun.run?.errorMessage || null).toBeNull()
    expect(completedRun.score).toBeTruthy()
    expect((completedRun.answers || []).length).toBeGreaterThan(0)

    const reportResponse = await callAuthedTextApi(page, '/api/propertyaudit/generate-report', {
      method: 'POST',
      body: {
        propertyId,
        runId: runId as string,
        template: 'executive',
        includeSections: ['recommendations'],
      },
    })
    expect(
      reportResponse.ok,
      `PropertyAudit report generation failed: ${JSON.stringify(reportResponse)}`
    ).toBeTruthy()
    expect(reportResponse.contentType).toContain('text/html')
    expect(reportResponse.text).toContain('<html')
    expect(reportResponse.text).toContain('GEO Visibility Report')

    const exportResponse = await callAuthedTextApi(
      page,
      `/api/propertyaudit/export?runId=${runId as string}&format=markdown`
    )
    expect(
      exportResponse.ok,
      `PropertyAudit export failed: ${JSON.stringify(exportResponse)}`
    ).toBeTruthy()
    expect(exportResponse.contentType).toContain('text/markdown')
    expect(exportResponse.text).toContain('# GEO Visibility Report')
    expect(exportResponse.text).toContain(`**Surface:** ${requestedSurface.toUpperCase()}`)
  })

  test('reviewflow sync to approval to post tracking stays auditable locally', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    const reviewSuffix = Date.now().toString(36)
    const platformReviewId = `local-smoke-review-${reviewSuffix}`

    const createReviewResponse = await callAuthedApi(page, '/api/reviewflow/reviews', {
      method: 'POST',
      body: {
        propertyId,
        platform: 'google',
        platformReviewId,
        reviewerName: 'Local Smoke Reviewer',
        rating: 4,
        reviewText: 'Local smoke test review to validate approval and posting audit flow.',
      },
    })
    expect(createReviewResponse.ok, `Review create failed: ${JSON.stringify(createReviewResponse)}`).toBeTruthy()
    const createReviewData = createReviewResponse.data as { review?: { id?: string; response_status?: string } }
    const reviewId = createReviewData.review?.id
    expect(typeof reviewId).toBe('string')
    expect(createReviewData.review?.response_status).toBe('pending')

    const generateResponse = await callAuthedApi(page, '/api/reviewflow/respond', {
      method: 'POST',
      body: {
        reviewId,
        tone: 'professional',
      },
    })
    expect(
      generateResponse.ok,
      `Review response generation failed (OPENAI key and model path must be configured locally): ${JSON.stringify(generateResponse)}`
    ).toBeTruthy()
    const generatedData = generateResponse.data as { response?: { id?: string } }
    const responseId = generatedData.response?.id
    expect(typeof responseId).toBe('string')

    const approveResponse = await callAuthedApi(page, '/api/reviewflow/respond', {
      method: 'PATCH',
      body: {
        responseId,
        action: 'approve',
      },
    })
    expect(approveResponse.ok, `Review approve failed: ${JSON.stringify(approveResponse)}`).toBeTruthy()

    const providerEvidenceUrl = `https://local-smoke.provider/review/${platformReviewId}`
    const postResponse = await callAuthedApi(page, '/api/reviewflow/respond', {
      method: 'PATCH',
      body: {
        responseId,
        action: 'post',
        manualConfirmed: true,
        providerPostUrl: providerEvidenceUrl,
      },
    })
    expect(postResponse.ok, `Review post tracking failed: ${JSON.stringify(postResponse)}`).toBeTruthy()

    const reviewsResponse = await callAuthedApi(
      page,
      `/api/reviewflow/reviews?propertyId=${propertyId}&status=posted&limit=100`
    )
    expect(reviewsResponse.ok).toBeTruthy()
    const reviewsData = reviewsResponse.data as {
      reviews?: Array<{
        id?: string
        response_status?: string
        review_responses?: Array<{ id?: string; status?: string; posted_at?: string | null }>
        review_tickets?: Array<{ title?: string; resolution_notes?: string | null }>
      }>
    }
    const postedReview = (reviewsData.reviews || []).find(review => review.id === reviewId)
    expect(postedReview).toBeTruthy()
    expect(postedReview?.response_status).toBe('posted')

    const postedResponseRecord = (postedReview?.review_responses || []).find(
      candidate => candidate.id === responseId
    )
    expect(postedResponseRecord?.status).toBe('posted')
    expect(typeof postedResponseRecord?.posted_at).toBe('string')

    const providerTicket = (postedReview?.review_tickets || []).find(ticket =>
      (ticket.title || '').includes('Provider response posted')
    )
    expect(providerTicket).toBeTruthy()
    expect(providerTicket?.resolution_notes || '').toContain(providerEvidenceUrl)
  })

  test('forgestudio generate to approve transition stays explicit locally', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    const draftSuffix = Date.now().toString(36)

    const generateResponse = await callAuthedApi(page, '/api/forgestudio/generate', {
      method: 'POST',
      body: {
        propertyId,
        contentType: 'social_post',
        platform: 'facebook',
        variables: {
          topic: `Local smoke social post ${draftSuffix}`,
          details: 'Deterministic local smoke path for generate->approve->schedule->publish.',
        },
        generateMedia: false,
      },
    })
    expect(
      generateResponse.ok,
      `ForgeStudio generate failed (OPENAI key and model path must be configured locally): ${JSON.stringify(generateResponse)}`
    ).toBeTruthy()

    const generateData = generateResponse.data as {
      draft?: { id?: string; status?: string }
      draftReadiness?: { isReady?: boolean; state?: string }
    }
    const draftId = generateData.draft?.id
    expect(typeof draftId).toBe('string')
    expect(generateData.draftReadiness?.isReady).toBe(true)
    expect(generateData.draft?.status).toBe('pending_review')

    const approveResponse = await callAuthedApi(page, '/api/forgestudio/drafts', {
      method: 'PATCH',
      body: {
        draftId,
        status: 'approved',
      },
    })
    expect(approveResponse.ok, `ForgeStudio approve failed: ${JSON.stringify(approveResponse)}`).toBeTruthy()

    const draftsResponse = await callAuthedApi(page, `/api/forgestudio/drafts?propertyId=${propertyId}&limit=100`)
    expect(draftsResponse.ok).toBeTruthy()
    const draftsData = draftsResponse.data as {
      drafts?: Array<{ id?: string; status?: string }>
    }
    const finalDraft = (draftsData.drafts || []).find(draft => draft.id === draftId)
    expect(finalDraft).toBeTruthy()
    expect(finalDraft?.status).toBe('approved')
  })

  test('forgestudio real-provider publish smoke per channel (opt-in)', async ({ page, request }) => {
    // A channel is launch-ready only after this passes against a real account:
    // OAuth connection, generation, approval, scheduling, worker publish, and
    // a canonical remote post URL. Gated per channel:
    //   FORGESTUDIO_REAL_SMOKE=1 FORGESTUDIO_REAL_SMOKE_PLATFORM=facebook
    test.setTimeout(300_000)
    test.skip(
      process.env.FORGESTUDIO_REAL_SMOKE !== '1',
      'Set FORGESTUDIO_REAL_SMOKE=1 to run the real-provider ForgeStudio publish smoke.'
    )
    const platform = process.env.FORGESTUDIO_REAL_SMOKE_PLATFORM
    test.skip(
      !platform || !['instagram', 'facebook', 'linkedin', 'tiktok', 'x'].includes(platform),
      'Set FORGESTUDIO_REAL_SMOKE_PLATFORM to one of instagram|facebook|linkedin|tiktok|x.'
    )
    const cronSecret = process.env.CRON_SECRET
    test.skip(!cronSecret, 'Set CRON_SECRET so the smoke can trigger the publication worker.')

    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(
      page,
      'FORGESTUDIO_REAL_SMOKE_PROPERTY_ID'
    )

    // The channel must already be connected through its real OAuth flow.
    const connectionsResponse = await callAuthedApi(
      page,
      `/api/forgestudio/social/connections?propertyId=${propertyId}`
    )
    expect(connectionsResponse.ok).toBeTruthy()
    const connections = (connectionsResponse.data as {
      connections?: Array<{ id: string; platform: string; is_active: boolean }>
    }).connections
    const connection = (connections || []).find(
      (candidate) =>
        (candidate.platform === platform || (platform === 'x' && candidate.platform === 'twitter')) &&
        candidate.is_active
    )
    test.skip(!connection, `No active ${platform} connection for this property; connect it first.`)

    // Brief → generate → approve → schedule for "now".
    const suffix = Date.now().toString(36)
    const briefResponse = await callAuthedApi(page, '/api/forgestudio/briefs', {
      method: 'POST',
      body: {
        propertyId,
        title: `Real-provider smoke ${suffix}`,
        objective: 'Verify the end-to-end publish path against a real provider account.',
        topic: `ForgeStudio launch check ${suffix}`,
        channels: [platform],
        connectionIds: [connection!.id],
      },
    })
    expect(briefResponse.ok, `Brief creation failed: ${JSON.stringify(briefResponse)}`).toBeTruthy()
    const briefId = (briefResponse.data as { brief?: { id?: string } }).brief?.id
    expect(typeof briefId).toBe('string')

    const generateResponse = await callAuthedApi(
      page,
      `/api/forgestudio/briefs/${briefId}/generate`,
      { method: 'POST', body: {} }
    )
    expect(
      generateResponse.ok,
      `Generation failed (OPENAI/AI Gateway key required): ${JSON.stringify(generateResponse)}`
    ).toBeTruthy()
    const revisionId = (generateResponse.data as { revision?: { id?: string } }).revision?.id
    expect(typeof revisionId).toBe('string')

    const approveResponse = await callAuthedApi(
      page,
      `/api/forgestudio/revisions/${revisionId}/approval`,
      { method: 'POST', body: { decision: 'approved' } }
    )
    expect(approveResponse.ok, `Approval failed: ${JSON.stringify(approveResponse)}`).toBeTruthy()

    const scheduleResponse = await callAuthedApi(page, '/api/forgestudio/publications', {
      method: 'POST',
      body: {
        revisionId,
        destinations: [
          { connectionId: connection!.id, scheduledFor: new Date().toISOString(), timezone: 'UTC' },
        ],
      },
    })
    expect(scheduleResponse.ok, `Scheduling failed: ${JSON.stringify(scheduleResponse)}`).toBeTruthy()
    const publicationId = (scheduleResponse.data as {
      publications?: Array<{ id?: string }>
    }).publications?.[0]?.id
    expect(typeof publicationId).toBe('string')

    // Duplicate scheduling must be refused before we ever hit the provider.
    const duplicateResponse = await callAuthedApi(page, '/api/forgestudio/publications', {
      method: 'POST',
      body: {
        revisionId,
        destinations: [
          { connectionId: connection!.id, scheduledFor: new Date().toISOString(), timezone: 'UTC' },
        ],
      },
    })
    expect(duplicateResponse.ok, 'Duplicate scheduling should be rejected').toBeFalsy()

    // Wake the worker (same path hosted cron uses) and poll for the outcome.
    let finalStatus: string | undefined
    let remoteUrl: string | null | undefined
    for (let attempt = 0; attempt < 20; attempt++) {
      const workerResponse = await request.get('/api/cron/process-publications', {
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      expect(workerResponse.ok()).toBeTruthy()

      const statusResponse = await callAuthedApi(
        page,
        `/api/forgestudio/publications/${publicationId}`
      )
      expect(statusResponse.ok).toBeTruthy()
      const publication = (statusResponse.data as {
        publication?: { status?: string; remote_post_url?: string | null }
      }).publication
      finalStatus = publication?.status
      remoteUrl = publication?.remote_post_url
      if (finalStatus === 'published' || finalStatus === 'failed') break
      await page.waitForTimeout(10_000)
    }

    expect(finalStatus, `Publication did not publish (status: ${finalStatus})`).toBe('published')
    expect(remoteUrl, 'Published post should expose a canonical remote URL').toBeTruthy()
  })

  test('brandforge analyze to generate edit export and embed flow stays deterministic locally', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    test.skip(
      !process.env.OPENAI_API_KEY,
      'Set OPENAI_API_KEY to run BrandForge local smoke.'
    )

    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)

    const analyzeResponse = await callAuthedApi(page, '/api/brandforge/analyze', {
      method: 'POST',
      body: {
        propertyId,
        address: {
          street: '123 Local Smoke Ave',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
        },
        propertyType: 'multifamily',
        radiusMiles: 1,
        maxCompetitors: 3,
      },
    })
    expect(analyzeResponse.ok, `BrandForge analyze failed: ${JSON.stringify(analyzeResponse)}`).toBe(true)
    const analysisData = analyzeResponse.data as { analysis?: Record<string, unknown> }
    expect(typeof analysisData.analysis).toBe('object')

    const startConversation = await callAuthedApi(page, '/api/brandforge/conversation', {
      method: 'POST',
      body: {
        propertyId,
        action: 'start',
        competitiveContext: analysisData.analysis,
      },
    })
    expect(startConversation.ok, `BrandForge conversation start failed: ${JSON.stringify(startConversation)}`).toBe(
      true
    )

    const startData = startConversation.data as {
      brandAssetId?: string
      conversationHistory?: Array<{ role?: string; content?: string }>
      status?: string
    }
    const brandAssetId = startData.brandAssetId
    expect(typeof brandAssetId).toBe('string')

    let conversationHistory = Array.isArray(startData.conversationHistory)
      ? startData.conversationHistory
      : []
    let conversationStatus = typeof startData.status === 'string' ? startData.status : ''

    for (let attempt = 0; attempt < 8 && conversationStatus !== 'ready_to_generate'; attempt++) {
      const nextConversation = await callAuthedApi(page, '/api/brandforge/conversation', {
        method: 'POST',
        body: {
          propertyId,
          brandAssetId,
          action: 'message',
          message:
            'Finalize now. Return conversationComplete true with concise JSON brand strategy so generation can begin.',
          conversationHistory,
          competitiveContext: analysisData.analysis,
        },
      })
      expect(
        nextConversation.ok,
        `BrandForge conversation message failed on attempt ${attempt + 1}: ${JSON.stringify(nextConversation)}`
      ).toBe(true)

      const nextData = nextConversation.data as {
        conversationHistory?: Array<{ role?: string; content?: string }>
        status?: string
      }
      conversationHistory = Array.isArray(nextData.conversationHistory) ? nextData.conversationHistory : []
      conversationStatus = typeof nextData.status === 'string' ? nextData.status : ''
    }

    expect(conversationStatus, `Conversation did not reach ready_to_generate: ${conversationStatus}`).toBe(
      'ready_to_generate'
    )

    for (let step = 1; step <= 12; step++) {
      const generateSection = await callAuthedApi(page, '/api/brandforge/generate-next-section', {
        method: 'POST',
        body: { brandAssetId },
      })
      expect(
        generateSection.ok,
        `BrandForge generate-next-section failed at step ${step}: ${JSON.stringify(generateSection)}`
      ).toBe(true)

      if (step === 1) {
        const generated = generateSection.data as { data?: Record<string, unknown> }
        const currentContent =
          typeof generated.data?.content === 'string' ? generated.data.content : 'Local smoke intro'
        const editSection = await callAuthedApi(page, '/api/brandforge/edit-section', {
          method: 'POST',
          body: {
            brandAssetId,
            updates: {
              content: `${currentContent} [edited in local smoke flow]`,
            },
          },
        })
        expect(editSection.ok, `BrandForge edit-section failed: ${JSON.stringify(editSection)}`).toBe(true)
      }

      const approveSection = await callAuthedApi(page, '/api/brandforge/approve-section', {
        method: 'POST',
        body: { brandAssetId },
      })
      expect(
        approveSection.ok,
        `BrandForge approve-section failed at step ${step}: ${JSON.stringify(approveSection)}`
      ).toBe(true)
    }

    const exportResponse = await callAuthedApi(page, '/api/brandforge/generate-pdf', {
      method: 'POST',
      body: { brandAssetId },
    })
    expect(exportResponse.ok, `BrandForge generate-pdf failed: ${JSON.stringify(exportResponse)}`).toBe(true)
    const exportData = exportResponse.data as { pdfUrl?: string; exportFormat?: string }
    expect(typeof exportData.pdfUrl).toBe('string')
    expect(exportData.exportFormat).toBe('pdf')

    const embedResponse = await callAuthedApi(page, '/api/brandforge/embed-to-kb', {
      method: 'POST',
      body: { brandAssetId, propertyId },
    })
    expect(embedResponse.ok, `BrandForge embed-to-kb failed: ${JSON.stringify(embedResponse)}`).toBe(true)
    const embedData = embedResponse.data as { embeddedChunks?: number; totalChunks?: number }
    expect((embedData.embeddedChunks || 0) > 0).toBe(true)
    expect((embedData.totalChunks || 0) > 0).toBe(true)

    const statusResponse = await callAuthedApi(page, `/api/brandforge/status?propertyId=${propertyId}`)
    expect(statusResponse.ok, `BrandForge status failed: ${JSON.stringify(statusResponse)}`).toBe(true)
    const statusData = statusResponse.data as {
      exists?: boolean
      brandAsset?: { isComplete?: boolean; pdfUrl?: string | null; approvedSections?: number }
    }
    expect(statusData.exists).toBe(true)
    expect(statusData.brandAsset?.isComplete).toBe(true)
    expect(statusData.brandAsset?.approvedSections).toBe(12)
    expect(typeof statusData.brandAsset?.pdfUrl).toBe('string')

    const legalResponse = await callAuthedApi(page, '/api/onboarding/legal', {
      method: 'PUT',
      body: {
        propertyId,
        jurisdiction: 'Texas, United States',
        legalEntityName: 'Local Smoke Property LLC',
        effectiveAt: new Date().toISOString(),
        approve: true,
        privacyPolicy: { text: 'Local smoke approved privacy policy.' },
        terms: { text: 'Local smoke approved website terms.' },
        accessibility: { text: 'Local smoke approved accessibility statement.' },
        fairHousing: { text: 'Local smoke approved Fair Housing statement.' },
        pricingDisclaimer: { text: 'Pricing and availability may change.' },
        analyticsConsent: { text: 'Analytics require consent.' },
        communicationsConsent: { text: 'Communications require consent.' },
        sourceReferences: [],
      },
    })
    expect(legalResponse.ok, `Legal approval failed: ${JSON.stringify(legalResponse)}`).toBe(true)
    const generation = await createApprovedSiteForgeGeneration(
      page,
      propertyId,
      'Generate from the approved generated-brand onboarding snapshot.',
    )
    expect(generation.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('existing brand import pins readiness and generates a canonical SiteForge preview', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)
    const uploaded = await page.evaluate(async ({ propertyId: targetPropertyId }) => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" fill="#123456"/><text x="160" y="70" text-anchor="middle" fill="white" font-size="32">Existing Brand</text></svg>'
      const form = new FormData()
      form.set('propertyId', targetPropertyId)
      form.set('role', 'primary_logo')
      form.set('rightsStatus', 'owned')
      form.set('altText', 'Existing Brand logo')
      form.set('file', new File([svg], 'existing-brand-logo.svg', { type: 'image/svg+xml' }))
      const uploadResponse = await fetch('/api/brandforge/content-assets', {
        method: 'POST',
        body: form,
      })
      const uploadBody = await uploadResponse.json()
      if (!uploadResponse.ok) return { ok: false, status: uploadResponse.status, data: uploadBody }
      const reviewResponse = await fetch('/api/brandforge/content-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: targetPropertyId,
          assetId: uploadBody.asset.id,
          approvalStatus: 'approved',
          rightsStatus: 'owned',
          rightsMetadata: { operatorConfirmed: true },
          altText: 'Existing Brand logo',
        }),
      })
      return {
        ok: reviewResponse.ok,
        status: reviewResponse.status,
        data: reviewResponse.ok ? uploadBody.asset : await reviewResponse.json(),
      }
    }, { propertyId })
    expect(uploaded.ok, `Existing logo governance failed: ${JSON.stringify(uploaded)}`).toBe(true)
    const logo = uploaded.data as { id: string; file_url: string }

    const previewResponse = await callAuthedApi(page, '/api/brandforge/import/preview', {
      method: 'POST',
      body: {
        propertyId,
        sourceType: 'manual',
        idempotencyKey: `local-smoke-existing-${crypto.randomUUID()}`,
        manual: {
          identity: { name: 'Existing Brand Apartments', tagline: 'Already established' },
          logos: {
            variants: [{
              role: 'primary',
              assetId: logo.id,
              url: logo.file_url,
              alt: 'Existing Brand logo',
              restrictions: ['Do not stretch'],
            }],
          },
          typography: {
            roles: [
              { role: 'headline', family: 'Arial', weights: [700], usage: 'Headlines', fallback: 'Arial, sans-serif' },
              { role: 'body', family: 'Georgia', weights: [400], usage: 'Body', fallback: 'Georgia, serif' },
            ],
          },
          colors: {
            roles: [
              { role: 'primary', name: 'Existing Blue', hex: '#123456', usage: 'Primary' },
              { role: 'secondary', name: 'White', hex: '#FFFFFF', usage: 'Background' },
              { role: 'accent', name: 'Gold', hex: '#D4A72C', usage: 'Calls to action' },
            ],
          },
        },
      },
    })
    expect(previewResponse.ok, `Existing brand preview failed: ${JSON.stringify(previewResponse)}`).toBe(true)
    const preview = (previewResponse.data as {
      preview?: { id?: string; extracted_contract?: Record<string, unknown> }
    }).preview
    expect(typeof preview?.id).toBe('string')

    const confirmResponse = await callAuthedApi(page, '/api/brandforge/import/confirm', {
      method: 'POST',
      body: {
        propertyId,
        importId: preview?.id,
        contract: preview?.extracted_contract,
        resolutions: {},
      },
    })
    expect(confirmResponse.ok, `Existing brand confirmation failed: ${JSON.stringify(confirmResponse)}`).toBe(true)
    const legalResponse = await callAuthedApi(page, '/api/onboarding/legal', {
      method: 'PUT',
      body: {
        propertyId,
        jurisdiction: 'Texas, United States',
        legalEntityName: 'Existing Brand Property LLC',
        effectiveAt: new Date().toISOString(),
        approve: true,
        privacyPolicy: { text: 'Approved privacy policy for existing brand smoke.' },
        terms: { text: 'Approved terms for existing brand smoke.' },
        accessibility: { text: 'Approved accessibility statement for existing brand smoke.' },
        fairHousing: { text: 'Approved Fair Housing statement for existing brand smoke.' },
        pricingDisclaimer: { text: 'Pricing and availability may change.' },
        analyticsConsent: { text: 'Analytics require consent.' },
        communicationsConsent: { text: 'Communications require consent.' },
        sourceReferences: [],
      },
    })
    expect(legalResponse.ok, `Existing-brand legal approval failed: ${JSON.stringify(legalResponse)}`).toBe(true)

    const generation = await createApprovedSiteForgeGeneration(
      page,
      propertyId,
      'Generate from the approved existing-brand contract and frozen onboarding truth.',
    )
    const status = await waitForWebsiteStatus(page, generation.websiteId, [
      'ready_for_preview',
      'complete',
      'failed',
    ], 90_000)
    expect(status.status, `Existing-brand SiteForge generation failed: ${JSON.stringify(status)}`)
      .not.toBe('failed')
    const artifactResponse = await callAuthedApi(
      page,
      `/api/siteforge/preview/${generation.websiteId}`
    )
    expect(
      artifactResponse.ok,
      `Current artifact lookup failed: ${JSON.stringify(artifactResponse)}`
    ).toBe(true)
    const artifactPayload = artifactResponse.data as {
      artifact?: {
        currentId?: string | null
        history?: Array<{ id?: string; content_hash?: string }>
      }
    }
    const currentArtifact = artifactPayload.artifact?.history?.find(
      artifact => artifact.id === artifactPayload.artifact?.currentId
    )
    expect(currentArtifact?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(currentArtifact?.content_hash).toMatch(/^[a-f0-9]{64}$/)
    const canonical = await callAuthedApi(
      page,
      `/api/siteforge/canonical-preview/${generation.websiteId}`,
      {
        method: 'POST',
        body: {
          artifactId: currentArtifact?.id,
          contentHash: currentArtifact?.content_hash,
        },
      }
    )
    expect(canonical.ok, `Canonical preview failed: ${JSON.stringify(canonical)}`).toBe(true)
    const canonicalData = canonical.data as {
      status?: string
      jobId?: string
      previewUrl?: string
    }
    if (canonical.status === 202) {
      expect(canonicalData.jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
      const terminal = await waitForCanonicalPreviewJob(
        page,
        generation.websiteId,
        canonicalData.jobId as string
      )
      expect(
        terminal.status,
        `Canonical preview job failed: ${JSON.stringify(terminal)}`
      ).toBe('succeeded')
    } else {
      expect(canonicalData.status).toBe('ready')
      expect(canonicalData.previewUrl).toMatch(/^https?:\/\//)
    }
    const exactPreview = await callAuthedApi(
      page,
      `/api/siteforge/preview/${generation.websiteId}`
    )
    const exactArtifact = (exactPreview.data as {
      artifact?: {
        currentId?: string | null
        canonicalPreviewArtifactId?: string | null
        canonicalPreviewContentHash?: string | null
        canonicalPreviewUrl?: string | null
      }
    }).artifact
    expect(exactArtifact?.canonicalPreviewArtifactId).toBe(currentArtifact?.id)
    expect(exactArtifact?.canonicalPreviewContentHash).toBe(
      currentArtifact?.content_hash
    )
    expect(exactArtifact?.canonicalPreviewUrl).toMatch(/^https?:\/\//)
  })
})
