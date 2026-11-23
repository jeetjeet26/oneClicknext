import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { isPlatformOperator } from '@/utils/services/platform-operator'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const META_API_VERSION = 'v26.0'
const MAX_ACCOUNT_PAGES = 100

const graphAccount = z.object({
  id: z.string().regex(/^act_\d+$/),
  name: z.string().optional(),
  account_status: z.number().optional(),
  currency: z.string().optional(),
  timezone_name: z.string().optional(),
  amount_spent: z.string().optional(),
})

const accountPage = z.object({
  data: z.array(graphAccount),
  paging: z.object({
    next: z.string().optional(),
    cursors: z.object({ after: z.string().optional() }).optional(),
  }).optional(),
})

async function listMetaAccounts(accessToken: string) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/me/adaccounts`)
  url.searchParams.set('fields', 'id,name,account_status,currency,timezone_name,amount_spent')
  url.searchParams.set('limit', '100')
  const signal = AbortSignal.timeout(25_000)
  const accounts = new Map<string, z.infer<typeof graphAccount>>()
  const seenCursors = new Set<string>()

  while (true) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error', cache: 'no-store', signal,
    })
    if (!response.ok) throw new Error(`Meta Ads account lookup returned HTTP ${response.status}`)
    const { data, paging } = accountPage.parse(await response.json())
    for (const account of data) accounts.set(account.id.replace(/^act_/, ''), account)
    if (!paging?.next) return accounts

    // Keep the bearer token on the known Graph API endpoint across all pages.
    const after = paging.cursors?.after
    if (!after || seenCursors.has(after) || seenCursors.size >= MAX_ACCOUNT_PAGES - 1) {
      throw new Error('Meta Ads account pagination did not complete')
    }
    seenCursors.add(after)
    url.searchParams.set('after', after)
  }
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

    // This token can span clients. Discovery requires a platform operator.
    if (!isPlatformOperator(user.id, profile.role ?? '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const accessToken = process.env.META_ACCESS_TOKEN?.trim()
    if (!accessToken) {
      return NextResponse.json({ error: 'Meta Ads not configured', accounts: [], configured: false })
    }

    let accounts: Awaited<ReturnType<typeof listMetaAccounts>>
    try {
      accounts = await listMetaAccounts(accessToken)
    } catch {
      return NextResponse.json({
        error: 'Could not list Meta Ads accounts. Check the access token and ad account permissions.',
        accounts: [], configured: true,
      }, { status: 502 })
    }

    const { data: existingConnections, error } = await supabase
      .from('ad_account_connections')
      .select('account_id, property_id, properties(name)')
      .eq('platform', 'meta_ads')
      .eq('org_id', profile.org_id)
    if (error) throw error

    const linksById = new Map((existingConnections ?? []).map(connection => [
      connection.account_id.replace(/^act_/, ''), connection,
    ]))
    const accountsWithStatus = [...accounts].map(([id, account]) => {
      const connection = linksById.get(id)
      return {
        ...account,
        id,
        name: account.name || `Account ${id}`,
        linked: !!connection,
        linked_property_id: connection?.property_id ?? null,
        linked_property_name: connection?.properties?.name ?? null,
      }
    })

    return NextResponse.json({ accounts: accountsWithStatus, configured: true })
  } catch {
    return NextResponse.json({
      error: 'Could not load saved Meta Ads connections.', accounts: [], configured: true,
    }, { status: 500 })
  }
}
