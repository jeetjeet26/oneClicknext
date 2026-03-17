import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET - Fetch goals for a property
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    
    if (!propertyId) {
      return NextResponse.json(
        { error: 'Property ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch goals for the property
    const { data: goals, error } = await supabase
      .from('metric_goals')
      .select('*')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .order('metric_key')

    if (error) {
      console.error('Error fetching goals:', error)
      return NextResponse.json(
        { error: 'Failed to fetch goals' },
        { status: 500 }
      )
    }

    return NextResponse.json({ goals: goals || [] })
  } catch (error) {
    console.error('Error in goals GET:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create or update a goal
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { propertyId, metricKey, goalType, targetValue, isInverse, alertThreshold } = body

    if (!propertyId || !metricKey || targetValue === undefined) {
      return NextResponse.json(
        { error: 'Property ID, metric key, and target value are required' },
        { status: 400 }
      )
    }

    const validMetrics = ['spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpa']
    if (!validMetrics.includes(metricKey)) {
      return NextResponse.json(
        { error: 'Invalid metric key' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Upsert the goal (create or update)
    const { data: goal, error } = await supabase
      .from('metric_goals')
      .upsert({
        property_id: propertyId,
        metric_key: metricKey,
        goal_type: goalType || 'monthly',
        target_value: targetValue,
        is_inverse: isInverse ?? (metricKey === 'cpa'),
        alert_threshold_percent: alertThreshold ?? 80,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'property_id,metric_key,goal_type'
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving goal:', error)
      return NextResponse.json(
        { error: 'Failed to save goal' },
        { status: 500 }
      )
    }

    return NextResponse.json({ goal, message: 'Goal saved successfully' })
  } catch (error) {
    console.error('Error in goals POST:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE - Remove a goal
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const goalId = searchParams.get('goalId')
    
    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: existingGoal, error: existingGoalError } = await supabase
      .from('metric_goals')
      .select('id, property_id')
      .eq('id', goalId)
      .single()

    if (existingGoalError || !existingGoal) {
      return NextResponse.json(
        { error: 'Goal not found' },
        { status: 404 }
      )
    }

    const access = await validatePropertyAccess(user.id, existingGoal.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Soft delete by setting is_active to false
    const { error } = await supabase
      .from('metric_goals')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', goalId)

    if (error) {
      console.error('Error deleting goal:', error)
      return NextResponse.json(
        { error: 'Failed to delete goal' },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: 'Goal deleted successfully' })
  } catch (error) {
    console.error('Error in goals DELETE:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

