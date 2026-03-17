import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Get onboarding tasks for the property
    const { data: tasks, error: tasksError } = await adminClient
      .from('onboarding_tasks')
      .select('*')
      .eq('property_id', propertyId)
      .order('priority', { ascending: false })

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError)
      return NextResponse.json({ error: 'Failed to fetch onboarding tasks' }, { status: 500 })
    }

    // Get property (profile data is now consolidated)
    const { data: property } = await adminClient
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .single()

    // Transform to profile format for backward compatibility
    const profile = property ? {
      id: property.id,
      property_id: property.id,
      community_type: property.property_type,
      website_url: property.website_url,
      unit_count: property.unit_count,
      year_built: property.year_built,
      amenities: property.amenities,
      pet_policy: property.pet_policy,
      parking_info: property.parking_info,
      special_features: property.special_features,
      brand_voice: property.brand_voice,
      target_audience: property.target_audience,
      office_hours: property.office_hours,
      social_media: property.social_media,
      intake_completed_at: property.onboarding_completed_at,
    } : null

    // Get contacts
    const { data: contacts } = await adminClient
      .from('property_contacts')
      .select('*')
      .eq('property_id', propertyId)

    // Get integrations
    const { data: integrations } = await adminClient
      .from('integration_credentials')
      .select('*')
      .eq('property_id', propertyId)

    // Get knowledge sources
    const { data: knowledgeSources } = await adminClient
      .from('knowledge_sources')
      .select('*')
      .eq('property_id', propertyId)

    // Calculate progress
    const totalTasks = tasks?.length || 0
    const completedTasks = tasks?.filter(t => t.status === 'completed').length || 0
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    // Group tasks by category
    const tasksByCategory = {
      setup: tasks?.filter(t => t.category === 'setup') || [],
      documents: tasks?.filter(t => t.category === 'documents') || [],
      integrations: tasks?.filter(t => t.category === 'integrations') || [],
      billing: tasks?.filter(t => t.category === 'billing') || [],
      training: tasks?.filter(t => t.category === 'training') || [],
      general: tasks?.filter(t => t.category === 'general') || [],
    }

    // Group tasks by status
    const tasksByStatus = {
      completed: tasks?.filter(t => t.status === 'completed') || [],
      in_progress: tasks?.filter(t => t.status === 'in_progress') || [],
      pending: tasks?.filter(t => t.status === 'pending') || [],
      blocked: tasks?.filter(t => t.status === 'blocked') || [],
    }

    return NextResponse.json({
      progress: {
        total: totalTasks,
        completed: completedTasks,
        percentage: progressPercentage,
      },
      tasks,
      tasksByCategory,
      tasksByStatus,
      profile,
      property,
      contacts,
      integrations,
      knowledgeSources,
    })
  } catch (error) {
    console.error('Onboarding status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Update a task status
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, status, notes } = body

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data: existingTask, error: existingTaskError } = await adminClient
      .from('onboarding_tasks')
      .select('id, property_id')
      .eq('id', taskId)
      .single()

    if (existingTaskError || !existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (typeof existingTask.property_id !== 'string') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, existingTask.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString()
      updateData.completed_by = user.id
    }

    if (notes !== undefined) {
      updateData.notes = notes
    }

    const { data: task, error } = await adminClient
      .from('onboarding_tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single()

    if (error) {
      console.error('Error updating task:', error)
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
    }

    return NextResponse.json({ success: true, task })
  } catch (error) {
    console.error('Task update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
