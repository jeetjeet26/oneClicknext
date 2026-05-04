import { expect, test } from '@playwright/test'

const seededUser = {
  email: 'local-admin@p11.test',
  password: 'local-dev-password',
}

const seededPropertyId = '33333333-3333-3333-3333-333333333333'

async function signInWithSeededUser() {
  // Placeholder to make the intent obvious if more setup gets added later.
  return seededUser
}

async function login(page: Parameters<typeof test>[0]['page']) {
  const user = await signInWithSeededUser()
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
  page: Parameters<typeof test>[0]['page'],
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

async function callAuthedTextApi(
  page: Parameters<typeof test>[0]['page'],
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
  page: Parameters<typeof test>[0]['page']
): Promise<string> {
  const propertiesResponse = await callAuthedApi(page, '/api/properties')
  expect(propertiesResponse.ok).toBeTruthy()
  const propertiesData = propertiesResponse.data as {
    properties?: Array<{ id?: string; name?: string }>
  }

  let properties = Array.isArray(propertiesData.properties)
    ? propertiesData.properties
    : []

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

  const fallback = properties.find(property => typeof property.id === 'string')?.id
  if (fallback) return fallback

  return seededPropertyId
}

async function ensurePropertyAuditQueries(
  page: Parameters<typeof test>[0]['page'],
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
  page: Parameters<typeof test>[0]['page'],
  websiteId: string,
  terminalStatuses: string[],
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs
  let lastResponse: { ok: boolean; status: number; data: unknown } | null = null

  while (Date.now() < deadline) {
    const statusResponse = await callAuthedApi(page, `/api/siteforge/status/${websiteId}`)
    lastResponse = statusResponse

    if (statusResponse.ok) {
      const statusData = statusResponse.data as Record<string, unknown>
      const status = typeof statusData.status === 'string' ? statusData.status : ''
      if (terminalStatuses.includes(status)) {
        return statusData
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(
    `Timed out waiting for website status ${terminalStatuses.join(', ')}: ${JSON.stringify(lastResponse)}`
  )
}

async function waitForPropertyAuditRun(
  page: Parameters<typeof test>[0]['page'],
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

function hasRealWordPressDeployTarget(): boolean {
  const hasCloudways = Boolean(process.env.CLOUDWAYS_API_KEY && process.env.CLOUDWAYS_EMAIL)
  const hasExistingWp = Boolean(
    process.env.SITEFORGE_WP_URL &&
      process.env.SITEFORGE_WP_USERNAME &&
      process.env.SITEFORGE_WP_APP_PASSWORD
  )
  return hasCloudways || hasExistingWp
}

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
        propertyType: 'apartment',
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

  test('siteforge deploy and rollback flow restores to previous generated version', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)

    const firstGenerateResponse = await callAuthedApi(page, '/api/siteforge/generate?simulate=1', {
      method: 'POST',
      body: {
        propertyId,
        prompt: 'Smoke test first generated version',
      },
    })
    expect(
      firstGenerateResponse.ok,
      `First generate failed: ${JSON.stringify(firstGenerateResponse)}`
    ).toBeTruthy()
    const firstGenerateData = firstGenerateResponse.data as Record<string, unknown>
    expect(typeof firstGenerateData.websiteId).toBe('string')
    const firstWebsiteId = firstGenerateData.websiteId as string

    const secondGenerateResponse = await callAuthedApi(page, '/api/siteforge/generate?simulate=1', {
      method: 'POST',
      body: {
        propertyId,
        prompt: 'Smoke test second generated version',
      },
    })
    expect(
      secondGenerateResponse.ok,
      `Second generate failed: ${JSON.stringify(secondGenerateResponse)}`
    ).toBeTruthy()
    const secondGenerateData = secondGenerateResponse.data as Record<string, unknown>
    expect(typeof secondGenerateData.websiteId).toBe('string')
    const secondWebsiteId = secondGenerateData.websiteId as string

    const generationStatus = await waitForWebsiteStatus(
      page,
      secondWebsiteId,
      ['ready_for_preview', 'complete', 'failed'],
      180_000
    )
    expect(
      generationStatus.status === 'ready_for_preview' || generationStatus.status === 'complete',
      `Generation did not reach ready state: ${JSON.stringify(generationStatus)}`
    ).toBe(true)

    const deployResponse = await callAuthedApi(
      page,
      `/api/siteforge/deploy/${secondWebsiteId}?simulate=1`,
      { method: 'POST' }
    )
    expect(deployResponse.ok, `Deploy request failed: ${JSON.stringify(deployResponse)}`).toBe(true)

    const deployedStatus = await waitForWebsiteStatus(
      page,
      secondWebsiteId,
      ['complete', 'deploy_failed'],
      120_000
    )
    expect(
      deployedStatus.status === 'complete',
      `Deploy did not complete successfully: ${JSON.stringify(deployedStatus)}`
    ).toBe(true)
    const deployedDiagnostics = deployedStatus.deploymentDiagnostics as
      | Record<string, unknown>
      | undefined
    expect(deployedDiagnostics?.status).toBe('success')
    expect(deployedDiagnostics?.provider).toBe('local_simulation')
    expect(
      (deployedDiagnostics?.verification as Record<string, unknown> | undefined)?.status
    ).toBe('passed')

    let rollbackPreviewData: Record<string, unknown> | null = null
    let rollbackPreviewLastResponse: { ok: boolean; status: number; data: unknown } | null = null
    for (let attempt = 0; attempt < 20; attempt++) {
      const rollbackPreviewResponse = await callAuthedApi(
        page,
        `/api/siteforge/rollback/${secondWebsiteId}`
      )
      rollbackPreviewLastResponse = rollbackPreviewResponse
      if (!rollbackPreviewResponse.ok) {
        await new Promise(resolve => setTimeout(resolve, 500))
        continue
      }
      rollbackPreviewData = rollbackPreviewResponse.data as Record<string, unknown>
      if (rollbackPreviewData.canRollback === true) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    expect(
      rollbackPreviewLastResponse?.ok,
      `Rollback preview request failed: ${JSON.stringify(rollbackPreviewLastResponse)}`
    ).toBeTruthy()
    expect(rollbackPreviewData, 'Rollback preview never became available').toBeTruthy()
    expect(rollbackPreviewData?.canRollback).toBe(true)
    expect(rollbackPreviewData?.rollbackToWebsiteId).toBe(firstWebsiteId)
    expect(typeof rollbackPreviewData.currentVersion).toBe('number')
    expect(typeof rollbackPreviewData.rollbackToVersion).toBe('number')
    expect(
      Number(rollbackPreviewData.currentVersion) > Number(rollbackPreviewData.rollbackToVersion)
    ).toBe(true)

    const rollbackResponse = await callAuthedApi(page, `/api/siteforge/rollback/${secondWebsiteId}`, {
      method: 'POST',
    })
    expect(rollbackResponse.ok).toBeTruthy()
    const rollbackData = rollbackResponse.data as Record<string, unknown>
    expect(rollbackData.success).toBe(true)
    expect(rollbackData.rolledBackToWebsiteId).toBe(firstWebsiteId)

    const statusData = await waitForWebsiteStatus(
      page,
      secondWebsiteId,
      ['ready_for_preview'],
      30_000
    )
    expect(statusData.status).toBe('ready_for_preview')
    expect(String(statusData.currentStep || '')).toContain('Rolled back to version')
    expect(statusData.wpUrl).toBeUndefined()
    expect(statusData.wpAdminUrl).toBeUndefined()
  })

  test('siteforge real target deploy and rollback flow (opt-in)', async ({ page }) => {
    const realDeployTimeoutMs = Number(process.env.SITEFORGE_REAL_DEPLOY_TIMEOUT_MS || 1_800_000)
    test.setTimeout(realDeployTimeoutMs + 120_000)
    test.skip(
      process.env.SITEFORGE_REAL_DEPLOY_SMOKE !== '1',
      'Set SITEFORGE_REAL_DEPLOY_SMOKE=1 to run real WordPress deploy smoke.'
    )
    test.skip(
      !hasRealWordPressDeployTarget(),
      'Requires Cloudways credentials or existing WordPress env vars.'
    )

    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)

    const firstGenerateResponse = await callAuthedApi(page, '/api/siteforge/generate?simulate=1', {
      method: 'POST',
      body: {
        propertyId,
        prompt: 'Real deploy smoke first generated version',
      },
    })
    expect(firstGenerateResponse.ok).toBeTruthy()
    const firstGenerateData = firstGenerateResponse.data as Record<string, unknown>
    const firstWebsiteId = firstGenerateData.websiteId as string

    const secondGenerateResponse = await callAuthedApi(page, '/api/siteforge/generate?simulate=1', {
      method: 'POST',
      body: {
        propertyId,
        prompt: 'Real deploy smoke second generated version',
      },
    })
    expect(secondGenerateResponse.ok).toBeTruthy()
    const secondGenerateData = secondGenerateResponse.data as Record<string, unknown>
    const secondWebsiteId = secondGenerateData.websiteId as string

    await waitForWebsiteStatus(
      page,
      secondWebsiteId,
      ['ready_for_preview', 'complete', 'failed'],
      60_000
    )

    const deployResponse = await callAuthedApi(page, `/api/siteforge/deploy/${secondWebsiteId}`, {
      method: 'POST',
    })
    expect(deployResponse.ok, `Real deploy request failed: ${JSON.stringify(deployResponse)}`).toBe(
      true
    )

    const deployedStatus = await waitForWebsiteStatus(
      page,
      secondWebsiteId,
      ['complete', 'deploy_failed'],
      realDeployTimeoutMs
    )
    expect(
      deployedStatus.status === 'complete',
      `Real deploy failed: ${JSON.stringify(deployedStatus)}`
    ).toBe(true)
    const deployedDiagnostics = deployedStatus.deploymentDiagnostics as
      | Record<string, unknown>
      | undefined
    expect(deployedDiagnostics?.status).toBe('success')
    expect(deployedDiagnostics?.provider).not.toBe('local_simulation')

    const rollbackPreviewResponse = await callAuthedApi(
      page,
      `/api/siteforge/rollback/${secondWebsiteId}`
    )
    expect(rollbackPreviewResponse.ok).toBeTruthy()
    const rollbackPreviewData = rollbackPreviewResponse.data as Record<string, unknown>
    expect(rollbackPreviewData.canRollback).toBe(true)
    expect(rollbackPreviewData.rollbackToWebsiteId).toBe(firstWebsiteId)

    const rollbackResponse = await callAuthedApi(page, `/api/siteforge/rollback/${secondWebsiteId}`, {
      method: 'POST',
    })
    expect(rollbackResponse.ok).toBeTruthy()

    const rolledBackStatus = await waitForWebsiteStatus(page, secondWebsiteId, ['ready_for_preview'], 60_000)
    expect(rolledBackStatus.status).toBe('ready_for_preview')
    expect(rolledBackStatus.wpUrl).toBeUndefined()
    expect(rolledBackStatus.wpAdminUrl).toBeUndefined()
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

    await login(page)
    const propertyId = await resolvePropertyIdForSmoke(page)

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
    const propertyId = await resolvePropertyIdForSmoke(page)
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
  })
})
