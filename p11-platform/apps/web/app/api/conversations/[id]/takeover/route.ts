/**
 * Human Takeover API
 * Allows agents to take over or release conversations from AI
 */

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'

// POST - Take over conversation
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAuth = await createClient()
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: conversationId } = await params
    const supabase = createServiceClient()

    const { data: existingConversation, error: existingConversationError } = await supabase
      .from('conversations')
      .select('id, property_id')
      .eq('id', conversationId)
      .single()

    if (existingConversationError || !existingConversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (typeof existingConversation.property_id !== 'string') {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const propertyAccess = await validatePropertyAccess(user.id, existingConversation.property_id)
    if (!propertyAccess.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Only admins and managers can take over conversations' },
        { status: 403 }
      )
    }

    // Update conversation to human mode
    const { data: conversation, error } = await supabase
      .from('conversations')
      .update({
        is_human_mode: true,
      })
      .eq('id', conversationId)
      .select(`
        id,
        is_human_mode,
        lead:leads(id, first_name, last_name, email, phone)
      `)
      .single()

    if (error) {
      console.error('Error taking over conversation:', error)
      return NextResponse.json({ error: 'Failed to take over conversation' }, { status: 500 })
    }

    // Add system message about takeover
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'system',
      content: `A team member has joined the chat and will continue assisting you.`,
    })

    return NextResponse.json({
      success: true,
      conversation,
      message: 'You have taken over this conversation',
    })
  } catch (error) {
    console.error('Takeover API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Release conversation back to AI
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAuth = await createClient()
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: conversationId } = await params
    const supabase = createServiceClient()

    // Get current conversation state
    const { data: current } = await supabase
      .from('conversations')
      .select('property_id')
      .eq('id', conversationId)
      .single()

    if (!current) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (typeof current.property_id !== 'string') {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const propertyAccess = await validatePropertyAccess(user.id, current.property_id)
    if (!propertyAccess.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Require elevated role to release human takeover mode.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Only admins and managers can release this conversation' },
        { status: 403 }
      )
    }

    // Update conversation back to AI mode
    const { data: conversation, error } = await supabase
      .from('conversations')
      .update({
        is_human_mode: false,
      })
      .eq('id', conversationId)
      .select('id, is_human_mode')
      .single()

    if (error) {
      console.error('Error releasing conversation:', error)
      return NextResponse.json({ error: 'Failed to release conversation' }, { status: 500 })
    }

    // Add system message about release
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'system',
      content: `Luma AI is back to assist you. How can I help?`,
    })

    return NextResponse.json({
      success: true,
      conversation,
      message: 'Conversation returned to AI mode',
    })
  } catch (error) {
    console.error('Release API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}



























