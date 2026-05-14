// SiteForge: Edit Website Section API
// POST /api/siteforge/edit/[websiteId]
// Allows LLM-driven editing of specific sections
// Created: December 16, 2025

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { generateBlueprintPatches } from '@/utils/siteforge/llm-patch-generator'
import { applyBlueprintPatch } from '@/utils/siteforge/blueprint'
import type { SiteBlueprint } from '@/types/siteforge'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { websiteId } = await params
    const { sectionId, userIntent } = await request.json()
    
    if (!sectionId || !userIntent) {
      return NextResponse.json(
        { error: 'sectionId and userIntent required' },
        { status: 400 }
      )
    }
    
    // Get current blueprint
    const { data: website, error: websiteError } = await supabase
      .from('property_websites')
      .select('blueprint, version, property_id')
      .eq('id', websiteId)
      .single()
    
    if (websiteError || !website) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 })
    }
    
    if (typeof website.property_id !== 'string') {
      return NextResponse.json({ error: 'Website property mapping is invalid' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const currentBlueprint = website.blueprint as unknown as SiteBlueprint
    
    // Generate patches using LLM
    const patches = await generateBlueprintPatches(
      currentBlueprint,
      sectionId,
      userIntent
    )
    
    // Apply patches to blueprint
    const updatedBlueprint = applyBlueprintPatch(
      currentBlueprint,
      patches
    )
    
    // Save new version
    const newVersion = (website.version || 1) + 1
    const updatePayload = {
      blueprint: updatedBlueprint,
      version: newVersion,
      updated_at: new Date().toISOString()
    }
    
    const serviceClient = createServiceClient()
    await serviceClient
      .from('property_websites')
      .update(updatePayload as never)
      .eq('id', websiteId)
    
    // Log edit action
    await serviceClient
      .from('mcp_audit_log')
      .insert({
        platform: 'siteforge-edit',
        tool_name: 'edit_section',
        operation_type: 'siteforge_edit_section',
        property_id: website.property_id,
        parameters: {
          websiteId,
          sectionId,
          userIntent,
          patchCount: patches.length
        },
        success: true,
      })
    
    return NextResponse.json({
      success: true,
      blueprint: updatedBlueprint,
      patches,
      newVersion
    })
    
  } catch (error) {
    console.error('Edit section error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to edit section' },
      { status: 500 }
    )
  }
}
