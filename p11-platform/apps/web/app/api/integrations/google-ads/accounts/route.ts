import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'

// Google Ads API endpoint for listing accessible customers
const GOOGLE_ADS_API_VERSION = 'v18'

interface GoogleAdsCustomer {
  customer_id: string
  descriptive_name: string
  currency_code?: string
  time_zone?: string
  manager?: boolean
  test_account?: boolean
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google OAuth credentials')
  }

  // Exchange refresh token for access token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get access token: ${error}`)
  }

  const data = await response.json()
  return data.access_token
}

async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN

  if (!developerToken) {
    throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN')
  }

  const response = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to list accessible customers: ${error}`)
  }

  const data = await response.json()
  // Returns { resourceNames: ["customers/1234567890", ...] }
  return (data.resourceNames || []).map((r: string) => r.replace('customers/', ''))
}

async function getCustomerDetails(
  accessToken: string,
  customerId: string,
  loginCustomerId: string
): Promise<GoogleAdsCustomer | null> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN

  if (!developerToken) {
    throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN')
  }

  // Use GAQL to get customer details
  const query = `
    SELECT 
      customer.id,
      customer.descriptive_name,
      customer.currency_code,
      customer.time_zone,
      customer.manager,
      customer.test_account
    FROM customer
    LIMIT 1
  `

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': developerToken,
          'login-customer-id': loginCustomerId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    )

    if (!response.ok) {
      // Some accounts may not be accessible, skip them
      console.warn(`Could not fetch details for customer ${customerId}`)
      return null
    }

    const data = await response.json()
    const customer = data.results?.[0]?.customer

    if (!customer) return null

    return {
      customer_id: customer.id,
      descriptive_name: customer.descriptiveName || `Account ${customer.id}`,
      currency_code: customer.currencyCode,
      time_zone: customer.timeZone,
      manager: customer.manager || false,
      test_account: customer.testAccount || false,
    }
  } catch (error) {
    console.error(`Error fetching customer ${customerId}:`, error)
    return null
  }
}

// Format customer ID with dashes (e.g., "1234567890" -> "123-456-7890")
function formatCustomerId(id: string): string {
  const cleaned = id.replace(/-/g, '')
  if (cleaned.length !== 10) return id
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
}

// GET - List all Google Ads accounts accessible via MCC
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

    // Check if Google Ads is configured
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    const mccId = process.env.GOOGLE_ADS_CUSTOMER_ID

    if (!developerToken || !mccId) {
      return NextResponse.json({ 
        error: 'Google Ads not configured',
        accounts: [],
        configured: false 
      })
    }

    // Get access token
    const accessToken = await getAccessToken()

    // List all accessible customer IDs
    const customerIds = await listAccessibleCustomers(accessToken)

    // Get details for each customer (in parallel, with rate limiting)
    const loginCustomerId = mccId.replace(/-/g, '')
    const customerDetailsPromises = customerIds.map((id) =>
      getCustomerDetails(accessToken, id, loginCustomerId)
    )
    const customerDetails = await Promise.all(customerDetailsPromises)

    // Filter out nulls and manager accounts (we want the actual ad accounts, not MCCs)
    const accounts = customerDetails
      .filter((c): c is GoogleAdsCustomer => c !== null && !c.manager)
      .map((c) => ({
        ...c,
        customer_id: formatCustomerId(c.customer_id),
      }))
      .sort((a, b) => a.descriptive_name.localeCompare(b.descriptive_name))

    // Get existing connections to show which are already linked
    const { data: existingConnections } = await supabase
      .from('ad_account_connections')
      .select('account_id, property_id, properties(name)')
      .eq('platform', 'google_ads')
      .eq('org_id', profile.org_id)

    // Map accounts with their connection status
    const accountsWithStatus = accounts.map((account) => {
      const connection = existingConnections?.find(
        (c) => c.account_id === account.customer_id
      )
      const props = connection?.properties ? (Array.isArray(connection.properties) ? connection.properties[0] : connection.properties) : null
      return {
        ...account,
        linked: !!connection,
        linked_property_id: connection?.property_id || null,
        linked_property_name: props?.name || null,
      }
    })

    return NextResponse.json({
      accounts: accountsWithStatus,
      mcc_id: formatCustomerId(mccId),
      configured: true,
    })
  } catch (error) {
    console.error('Google Ads accounts API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Server error'
    
    // Check for common Google Ads API errors
    if (errorMessage.includes('UNIMPLEMENTED') || errorMessage.includes('not implemented')) {
      return NextResponse.json({
        error: 'Google Ads API access issue. Please ensure: 1) Google Ads API is enabled in Google Cloud Console, 2) Developer token has production access (not test mode).',
        accounts: [],
        configured: true, // Credentials ARE set, but API access is failing
        api_error: errorMessage,
      })
    }
    
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

