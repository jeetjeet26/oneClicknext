// WordPress Discovery API Bridge
// Serves WordPress capability discovery to browser-side SiteForge callers.
// Discovery talks to the oneclick-siteforge theme's REST API directly
// (utils/siteforge/wordpress-discovery.ts) and falls back to the theme's
// built-in capability set when no live instance is reachable.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { discoverWordPressCapabilities } from '@/utils/siteforge/wordpress-discovery'

const SUPPORTED_TOOLS = ['get_wordpress_capabilities'] as const

/**
 * POST /api/mcp/wordpress
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { tool } = await request.json()

    if (!tool) {
      return NextResponse.json(
        { error: 'Tool name required' },
        { status: 400 }
      )
    }

    if (tool !== 'get_wordpress_capabilities') {
      return NextResponse.json(
        { error: `Unsupported tool: ${tool}. Supported: ${SUPPORTED_TOOLS.join(', ')}` },
        { status: 400 }
      )
    }

    const result = await discoverWordPressCapabilities()
    return NextResponse.json({ result })
  } catch (error) {
    console.error('WordPress discovery error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    service: 'WordPress Discovery Bridge',
    status: 'ready',
    tools: SUPPORTED_TOOLS,
  })
}
