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
    
    // In development without WordPress MCP configured, return clear error
    // instead of silently falling back to mocks
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // Only return mocks if explicitly in development mode and MCP not configured
    if (process.env.NODE_ENV === 'development' && errorMessage.includes('ENOENT')) {
      console.warn('WordPress MCP not running, returning mock data for development')
      return getMockResponse(tool, args)
    }
    
    throw new Error(`WordPress MCP error: ${errorMessage}. Ensure CLOUDWAYS_API_KEY is set and MCP server is running.`)
  }
}

/**
 * Mock responses for development (until MCP server is fully set up)
 */
function getMockResponse(tool: string, args: Record<string, unknown>): unknown {
  
  if (tool === 'get_wordpress_abilities') {
    return {
      available_blocks: [
        'acf/menu',
        'acf/top-slides',
        'acf/text-section',
        'acf/feature-section',
        'acf/image',
        'acf/links',
        'acf/content-grid',
        'acf/form',
        'acf/map',
        'acf/html-section',
        'acf/gallery',
        'acf/accordion-section',
        'acf/plans-availability',
        'acf/poi'
      ],
      theme: {
        name: 'collection',
        version: '2.1.0',
        supports: {
          custom_css: true,
          custom_fonts: true,
          block_patterns: true
        }
      },
      plugins: ['advanced-custom-fields-pro', 'yoast-seo', 'wp-rocket'],
      capabilities: {
        can_create_pages: true,
        can_upload_media: true,
        can_modify_theme: false,
        can_install_plugins: false,
        max_upload_size_mb: 100
      }
    }
  }
  
  if (tool === 'get_acf_block_schemas') {
    return {
      'acf/top-slides': {
        label: 'Hero Carousel',
        fields: {
          slides: { type: 'repeater' },
          autoplay: { type: 'boolean', default: true },
          overlay_style: { 
            type: 'select', 
            choices: ['none', 'light', 'dark', 'gradient'] 
          }
        },
        variants: {
          fullwidth: {
            css_class: 'hero-fullwidth',
            description: 'Full viewport hero',
            best_for: ['luxury', 'impact', 'resort']
          },
          split: {
            css_class: 'hero-split',
            description: 'Two-column layout',
            best_for: ['lifestyle', 'family']
          }
        }
      },
      'acf/content-grid': {
        label: 'Content Grid',
        fields: {
          columns: { type: 'select', choices: ['2', '3', '4'], default: '3' },
          items: { type: 'repeater' }
        },
        variants: {
          'elevated-cards': {
            css_class: 'grid-elevated',
            best_for: ['luxury', 'modern']
          }
        }
      }
    }
  }
  
  if (tool === 'get_theme_design_tokens') {
    return {
      colors: {
        primary: '#4F46E5',
        secondary: '#10B981',
        availableVariants: ['primary', 'secondary', 'accent', 'neutral']
      },
      typography: {
        availableFonts: ['Inter', 'Playfair Display', 'Montserrat', 'Open Sans'],
        headingScales: ['compact', 'balanced', 'luxury']
      },
      spacing: {
        availableScales: ['tight', 'balanced', 'luxury'],
        presets: {
          tight: { section: '4rem', container: '1200px' },
          balanced: { section: '6rem', container: '1400px' },
          luxury: { section: '8rem', container: '1600px' }
        }
      }
    }
  }
  
  if (tool === 'analyze_existing_site') {
    return {
      url: args.url,
      detected_theme: 'collection',
      design_analysis: {
        hero_style: { style: 'fullwidth', has_overlay: true },
        color_palette: { primary: '#2B5C7F', secondary: '#8B6F47' },
        typography: { fonts: ['Playfair Display', 'Open Sans'], heading_scale: 'luxury' }
      },
      insights_for_agents: {
        architecture_agent: 'Use fullwidth hero, prominent interest form',
        design_agent: 'Luxury spacing, serif headings, warm colors',
        photo_agent: '60% lifestyle ratio, warm lighting'
      }
    }
  }
  
  return {}
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










