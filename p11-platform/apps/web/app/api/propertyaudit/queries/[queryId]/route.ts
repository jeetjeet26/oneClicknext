/**
 * PropertyAudit Query Update API
 * Update individual queries
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// PATCH: Update a query
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ queryId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { queryId } = await params
    const body = await req.json()
    const { text, type, weight, geo, isActive, runCount } = body

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (text !== undefined) updateData.text = text
    if (type !== undefined) updateData.type = type
    if (weight !== undefined) updateData.weight = weight
    if (geo !== undefined) updateData.geo = geo
    if (isActive !== undefined) updateData.is_active = isActive
    if (runCount !== undefined) updateData.run_count = runCount

    const { data: query, error } = await supabase
      .from('geo_queries')
      .update(updateData)
      .eq('id', queryId)
      .select()
      .single()

    if (error) {
      console.error('Error updating query:', error)
      return NextResponse.json({ error: 'Failed to update query' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      query: {
        id: query.id,
        propertyId: query.property_id,
        text: query.text,
        type: query.type,
        geo: query.geo,
        weight: query.weight,
        runCount: query.run_count,
        isActive: query.is_active,
        createdAt: query.created_at,
        updatedAt: query.updated_at
      }
    })
  } catch (error) {
    console.error('PropertyAudit Query PATCH Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Delete a query
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ queryId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { queryId } = await params

    const { error } = await supabase
      .from('geo_queries')
      .delete()
      .eq('id', queryId)

    if (error) {
      console.error('Error deleting query:', error)
      return NextResponse.json({ error: 'Failed to delete query' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('PropertyAudit Query DELETE Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}









