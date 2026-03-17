// SiteForge: Generate Website API
// POST /api/siteforge/generate
// Created: December 11, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { SiteForgeOrchestrator, type BrandContext } from '@/utils/siteforge/agents'
import type { GenerateWebsiteRequest, GeneratedPage, SiteArchitecture } from '@/types/siteforge'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: GenerateWebsiteRequest = await request.json()
    const { propertyId, preferences, prompt, brandContext } = body
    const localSimulationEnabled =
      new URL(request.url).searchParams.get('simulate') === '1' &&
      process.env.NODE_ENV !== 'production'

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    // Verify user has access to this property
    const { data: property, error: propertyError } = await serviceSupabase
      .from('properties')
      .select('id, name, org_id')
      .eq('id', propertyId)
      .single()

    if (propertyError || !property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get current version number for this property
    const { data: existingWebsites } = await serviceSupabase
      .from('property_websites')
      .select('version')
      .eq('property_id', propertyId)
      .order('version', { ascending: false })
      .limit(1)

    const nextVersion = existingWebsites && existingWebsites.length > 0 
      ? (existingWebsites[0].version || 1) + 1 
      : 1
    const nowIso = new Date().toISOString()

    const simulatedPages = localSimulationEnabled
      ? buildLocalSimulationPages(property.name)
      : undefined
    const simulatedArchitecture = localSimulationEnabled
      ? buildLocalSimulationArchitecture(simulatedPages || [])
      : undefined

    // Create website record
    const websitePayload = {
      property_id: propertyId,
      version: nextVersion,
      generation_status: localSimulationEnabled ? 'ready_for_preview' : 'queued',
      generation_progress: localSimulationEnabled ? 100 : 0,
      current_step: localSimulationEnabled
        ? 'Generation complete (local simulation).'
        : 'Queued for generation',
      user_preferences: preferences,
      generation_input: {
        prompt: prompt || null,
        createdAt: nowIso,
        localSimulation: localSimulationEnabled
          ? {
              enabled: true,
              completedAt: nowIso,
            }
          : undefined,
      },
      generation_started_at: nowIso,
      generation_completed_at: localSimulationEnabled ? nowIso : null,
      generation_duration_seconds: localSimulationEnabled ? 0 : null,
      pages_generated: localSimulationEnabled ? simulatedPages : null,
      site_architecture: localSimulationEnabled ? simulatedArchitecture : null,
    }

    const { data: website, error: websiteError } = await serviceSupabase
      .from('property_websites')
      .insert(websitePayload as never)
      .select()
      .single()

    if (websiteError || !website) {
      console.error('Error creating website record:', websiteError)
      return NextResponse.json({ error: 'Failed to create website' }, { status: 500 })
    }

    // Create job for async processing
    const jobPayload = {
      website_id: website.id,
      job_type: 'full_generation',
      status: localSimulationEnabled ? 'complete' : 'queued',
      input_params: {
        propertyId,
        preferences,
        prompt,
        localSimulation: localSimulationEnabled,
      },
      output_data: localSimulationEnabled
        ? {
            mode: 'local_simulation',
            completedAt: nowIso,
          }
        : null,
      started_at: localSimulationEnabled ? nowIso : null,
      completed_at: localSimulationEnabled ? nowIso : null,
    }

    const { data: job, error: jobError } = await serviceSupabase
      .from('siteforge_jobs')
      .insert(jobPayload as never)
      .select()
      .single()

    if (jobError) {
      console.error('Error creating job:', jobError)
    }

    if (!localSimulationEnabled) {
      // Start generation in background (don't wait)
      // Pass pre-analyzed brandContext to avoid running Brand Agent twice
      generateWebsiteAsync(website.id, propertyId, preferences, prompt, brandContext).catch(error => {
        console.error('Background generation error:', error)
      })
    }

    return NextResponse.json({
      jobId: job?.id || website.id,
      websiteId: website.id,
      status: 'queued',
      estimatedTimeSeconds: localSimulationEnabled ? 1 : 180,
      localSimulation: localSimulationEnabled,
    })

  } catch (error) {
    console.error('Generate website error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate website' },
      { status: 500 }
    )
  }
}

function buildLocalSimulationPages(propertyName: string | null | undefined): GeneratedPage[] {
  const label = propertyName || 'Property'
  return [
    {
      slug: 'home',
      title: `${label} Home`,
      purpose: 'Provide a deterministic local preview page for smoke validation.',
      sections: [],
    },
  ]
}

function buildLocalSimulationArchitecture(pages: GeneratedPage[]): SiteArchitecture {
  return {
    navigation: {
      structure: 'primary',
      items: pages.map((page, index) => ({
        label: page.title,
        slug: page.slug,
        priority: index === 0 ? 'high' : 'medium',
      })),
      cta: {
        text: 'Schedule a Tour',
        style: 'primary',
      },
    },
    pages,
    designDecisions: {
      colorStrategy: 'local-simulation',
      imageStrategy: 'local-simulation',
      contentDensity: 'balanced',
      conversionOptimization: ['Deterministic local simulation for smoke validation'],
    },
  }
}

/**
 * Background generation process - AGENTIC VERSION
 * Uses orchestrator to coordinate all agents
 * 
 * @param brandContext - Pre-analyzed brand context from /api/siteforge/analyze
 *                       If provided, skips running Brand Agent again
 */
async function generateWebsiteAsync(
  websiteId: string,
  propertyId: string,
  preferences?: GenerateWebsiteRequest['preferences'],
  prompt?: string,
  brandContext?: BrandContext
) {
  const supabase = createServiceClient()
  
  try {
    // Initialize orchestrator with all agents
    const orchestrator = new SiteForgeOrchestrator(
      propertyId,
      websiteId,
      undefined // No existing WP instance yet
    )
    
    // Generate complete blueprint (agents work autonomously)
    // Pass pre-analyzed brandContext to skip re-running Brand Agent
    const normalizedPreferences = preferences
      ? (preferences as unknown as Record<string, unknown>)
      : undefined
    const blueprint = await orchestrator.generate(normalizedPreferences, brandContext)
    
    // Blueprint is already saved by orchestrator
    console.log('✅ Agentic generation complete:', {
      pages: blueprint.pages.length,
      sections: blueprint.pages.reduce((sum, p) => sum + p.sections.length, 0),
      quality: blueprint.qualityReport.score,
      time: blueprint.generationTime
    })
    
  } catch (error) {
    console.error('Agentic generation error:', error)
    
    await supabase
      .from('property_websites')
      .update({
        generation_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Generation failed'
      })
      .eq('id', websiteId)
  }
}

// Old asset gathering function removed - Photo Agent handles this now








