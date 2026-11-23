import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { isPlatformOperator } from '@/utils/services/platform-operator'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  formatGoogleAdsCustomerId, googleAdsSearch, googleAdsTokenRequest, legacyGoogleAdsGrant, readGoogleAdsAgency,
  type GoogleAdsGrant,
} from '@/utils/marketvision/google-ads-agency'

const MAX_ACCOUNT_PAGES = 100

// customer_client includes descendants at all depths under the configured manager.
const accountQuery = `
  SELECT customer_client.id, customer_client.descriptive_name,
    customer_client.currency_code, customer_client.time_zone,
    customer_client.manager, customer_client.test_account
  FROM customer_client
  WHERE customer_client.manager = FALSE
`

const customerClient = z.object({
  id: z.string().regex(/^\d{10}$/),
  descriptiveName: z.string().optional(),
  currencyCode: z.string().optional(),
  timeZone: z.string().optional(),
  manager: z.boolean().optional(),
  testAccount: z.boolean().optional(),
})

const accountPage = z.object({
  results: z.array(z.object({ customerClient })).optional(),
  nextPageToken: z.string().optional(),
}).refine(page => !page.nextPageToken || page.results !== undefined)

async function listManagerAccounts(grant: GoogleAdsGrant) {
  const signal = AbortSignal.timeout(25_000)
  const { access_token } = await googleAdsTokenRequest(grant, {
    grant_type: 'refresh_token', refresh_token: grant.refreshToken,
  }, signal)

  const accounts = new Map<string, z.infer<typeof customerClient>>()
  const seenPageTokens = new Set<string>()
  let pageToken: string | undefined
  do {
    const page = accountPage.parse(await googleAdsSearch(
      grant.managerId, access_token, accountQuery, signal, pageToken, grant.developerToken,
    ))
    for (const { customerClient: customer } of page.results ?? []) {
      if (!customer.manager) accounts.set(customer.id, customer)
    }
    pageToken = page.nextPageToken
    if (pageToken) {
      if (seenPageTokens.has(pageToken) || seenPageTokens.size >= MAX_ACCOUNT_PAGES - 1) {
        throw new Error('Google Ads account pagination did not complete')
      }
      seenPageTokens.add(pageToken)
    }
  } while (pageToken)

  return [...accounts.values()].map(customer => ({
    customer_id: formatGoogleAdsCustomerId(customer.id),
    descriptive_name: customer.descriptiveName || `Account ${customer.id}`,
    currency_code: customer.currencyCode,
    time_zone: customer.timeZone,
    manager: false,
    test_account: customer.testAccount ?? false,
  })).sort((a, b) => a.descriptive_name.localeCompare(b.descriptive_name))
}

export async function GET() {
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  try {
    const { data: profile } = await supabase.from('profiles').select('org_id, role').eq('id', user.id).single()
    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    // The shared refresh token can reach accounts in multiple organizations.
    if (!isPlatformOperator(user.id, profile.role ?? '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const saved = await readGoogleAdsAgency(supabase, profile.org_id)
    const grant = saved
      ? saved.refreshToken && { ...saved.app, refreshToken: saved.refreshToken }
      : legacyGoogleAdsGrant()
    if (!grant) {
      return NextResponse.json({
        error: 'Authorize Google Ads once in Agency advertising settings, then select an advertiser here.',
        accounts: [], configured: false,
      })
    }

    let accounts: Awaited<ReturnType<typeof listManagerAccounts>>
    try {
      accounts = await listManagerAccounts(grant)
    } catch {
      return NextResponse.json({
        error: 'Could not list Google Ads accounts. Check the manager account authorization in Agency advertising settings.',
        accounts: [], configured: true,
      }, { status: 502 })
    }

    const { data: existingConnections, error } = await supabase
      .from('ad_account_connections')
      .select('account_id, property_id, properties(name)')
      .eq('platform', 'google_ads')
      .eq('org_id', profile.org_id)
    if (error) throw error

    const linksById = new Map((existingConnections ?? []).map(connection => [
      connection.account_id.replace(/-/g, ''), connection,
    ]))
    const accountsWithStatus = accounts.map(account => {
      const connection = linksById.get(account.customer_id.replace(/-/g, ''))
      return {
        ...account,
        linked: !!connection,
        linked_property_id: connection?.property_id ?? null,
        linked_property_name: connection?.properties?.name ?? null,
      }
    })

    return NextResponse.json({ accounts: accountsWithStatus, mcc_id: formatGoogleAdsCustomerId(grant.managerId), configured: true })
  } catch {
    return NextResponse.json({
      error: 'Could not load saved Google Ads connections.', accounts: [], configured: true,
    }, { status: 500 })
  }
}
