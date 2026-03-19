// WordPress MCP API Bridge
// Bridges TypeScript frontend to Python MCP server
// Created: December 16, 2025

import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { createClient } from '@/utils/supabase/server'

const execAsync = promisify(exec)

/**
 * POST /api/mcp/wordpress
 * Calls WordPress MCP server tools
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { tool, arguments: args } = await request.json()
    
    if (!tool) {
      return NextResponse.json(
        { error: 'Tool name required' },
        { status: 400 }
      )
    }
    
    // Call Python MCP server
    const result = await callWordPressMcp(tool, args)
    
    return NextResponse.json({ result })
    
  } catch (error) {
    console.error('WordPress MCP error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Call WordPress MCP server
 * In production, this would use MCP protocol directly
 * For now, calls Python script
 */
async function callWordPressMcp(
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  
  const mcpServerPath = path.join(
    process.cwd(),
    '..',
    'services',
    'mcp-servers',
    'wordpress'
  )
  
  // Create input JSON
  const input = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: tool,
      arguments: args
    },
    id: 1
  }
  
  // Call MCP server via Python
  // In production, use proper MCP protocol transport
  const command = `cd "${mcpServerPath}" && python -m wordpress.server --call "${JSON.stringify(input).replace(/"/g, '\\"')}"`
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      env: {
        ...process.env,
        PYTHONPATH: path.join(process.cwd(), '..', 'services', 'mcp-servers')
      }
    })
    
    if (stderr) {
      console.error('MCP stderr:', stderr)
    }
    
    // Parse MCP response
    const response = JSON.parse(stdout)
    
    if (response.error) {
      throw new Error(response.error.message)
    }
    
    return response.result
    
  } catch (error) {
    console.error('Failed to call WordPress MCP:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`WordPress MCP error: ${errorMessage}. Ensure CLOUDWAYS_API_KEY is set and MCP server is running.`)
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    service: 'WordPress MCP Bridge',
    status: 'ready',
    tools: [
      'get_wordpress_abilities',
      'get_acf_block_schemas',
      'get_theme_design_tokens',
      'analyze_existing_site',
      'create_wordpress_instance',
      'deploy_siteforge_blueprint'
    ]
  })
}










