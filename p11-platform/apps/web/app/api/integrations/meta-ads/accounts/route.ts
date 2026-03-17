import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'

type MetaAdAccount = {
  id: string
  name: string
  account_status: number
  currency: string
  timezone_name: string
  amount_spent: string
  linked: boolean
  linked_property_id?: string | null
  linked_property_name?: string | null
}

type MetaGraphAdAccount = {
  id: string
  name: string
  account_status: number
  currency: string
  timezone_name: string
  amount_spent: string
}

/**
 * GET /api/integrations/meta-ads/accounts
 * 
 * Fetches Meta (Facebook/Instagram) ad accounts using direct API call.
 * Returns accounts with their connection status.
 */
export async function GET() {
  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    // Get user's profile to find their organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    const userRole = profile.role ?? ''

    // Check if user has permission
    if (!['admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Check if Meta Ads is configured
    const accessToken = process.env.META_ACCESS_TOKEN

    if (!accessToken) {
      return NextResponse.json({ 
        error: 'Meta Ads not configured',
        accounts: [],
        configured: false 
      })
    }

    // Call Meta Graph API to list ad accounts
    const response = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status,currency,timezone_name,amount_spent&access_token=${accessToken}`
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Failed to fetch Meta ad accounts')
    }

    const data = await response.json()
    const accounts = data.data || []

    // Get existing connections to show which are already linked
    const { data: existingConnections } = await supabase
      .from('ad_account_connections')
      .select('account_id, property_id, properties(name)')
      .eq('platform', 'meta_ads')
      .eq('org_id', profile.org_id)

    // Map accounts with their connection status
    const typedAccounts = accounts as MetaGraphAdAccount[]
    const accountsWithStatus: MetaAdAccount[] = typedAccounts.map((account) => {
      // Remove 'act_' prefix for storage
      const accountId = account.id.replace('act_', '')
      
      const connection = existingConnections?.find(
        (c) => c.account_id === accountId
      )
      const props = connection?.properties ? (Array.isArray(connection.properties) ? connection.properties[0] : connection.properties) : null
      
      return {
        id: accountId,
        name: account.name,
        account_status: account.account_status,
        currency: account.currency,
        timezone_name: account.timezone_name,
        amount_spent: account.amount_spent,
        linked: !!connection,
        linked_property_id: connection?.property_id || null,
        linked_property_name: props?.name || null,
      }
    })

    return NextResponse.json({
      accounts: accountsWithStatus,
      configured: true,
    })
  } catch (error) {
    console.error('Meta Ads accounts API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Server error'
    
    return NextResponse.json(
      { 
        error: errorMessage,
        accounts: [],
        configured: true,
        api_error: errorMessage,
      },
      { status: 500 }
    )
  }
}





