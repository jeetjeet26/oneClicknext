import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = request.nextUrl.searchParams.get('propertyId')
    
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Fetch tasks
    const { data: tasks, error: tasksError } = await adminClient
      .from('onboarding_tasks')
      .select('*')
      .eq('property_id', propertyId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError)
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
    }

    // Calculate progress
    const total = tasks?.length || 0
    const completed = tasks?.filter(t => t.status === 'completed').length || 0
    const inProgress = tasks?.filter(t => t.status === 'in_progress').length || 0
    const pending = tasks?.filter(t => t.status === 'pending').length || 0
    const blocked = tasks?.filter(t => t.status === 'blocked').length || 0
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0

    // Group tasks by status
    const groupedTasks = {
      completed: tasks?.filter(t => t.status === 'completed') || [],
      inProgress: tasks?.filter(t => t.status === 'in_progress') || [],
      pending: tasks?.filter(t => t.status === 'pending') || [],
      blocked: tasks?.filter(t => t.status === 'blocked') || [],
      skipped: tasks?.filter(t => t.status === 'skipped') || [],
    }

    return NextResponse.json({
      tasks: tasks || [],
      groupedTasks,
      stats: {
        total,
        completed,
        inProgress,
        pending,
        blocked,
        progress,
      },
    })
  } catch (error) {
    console.error('Tasks fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, status, notes, blockedReason } = body

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

    const updates: Record<string, unknown> = {
      status,
    }

    if (notes !== undefined) updates.notes = notes
    if (blockedReason !== undefined) updates.blocked_reason = blockedReason

    // Set completed_at and completed_by when marking complete
    if (status === 'completed') {
      updates.completed_at = new Date().toISOString()
      updates.completed_by = user.id
    } else if (status !== 'completed') {
      updates.completed_at = null
      updates.completed_by = null
    }

    const { data, error } = await adminClient
      .from('onboarding_tasks')
      .update(updates)
      .eq('id', taskId)
      .select()
      .single()

    if (error) {
      console.error('Error updating task:', error)
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error('Task update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { propertyId, taskType, taskName, description, category, priority } = body

    if (!propertyId || !taskType || !taskName) {
      return NextResponse.json({ error: 'propertyId, taskType, and taskName are required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('onboarding_tasks')
      .insert({
        property_id: propertyId,
        task_type: taskType,
        task_name: taskName,
        description: description || null,
        category: category || 'general',
        priority: priority || 0,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating task:', error)
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error('Task create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

