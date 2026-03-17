import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

function safeTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

// GET - List conversations for a property
export async function GET(req: NextRequest) {
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  const conversationId = searchParams.get('conversationId')
  const leadId = searchParams.get('leadId')

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()

  try {
    // If conversationId provided, get that specific conversation with messages
    if (conversationId) {
      const { data: conversation, error } = await supabase
        .from('conversations')
        .select(`
          id,
          channel,
          created_at,
          is_human_mode,
          lead:leads(first_name, last_name, email, phone),
          messages(id, role, content, created_at)
        `)
        .eq('id', conversationId)
        .eq('property_id', propertyId)
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      // Sort messages by created_at
      if (conversation?.messages) {
        conversation.messages.sort((a, b) =>
          safeTimestamp(a.created_at) - safeTimestamp(b.created_at)
        )
      }

      return NextResponse.json({ conversation })
    }

    // Otherwise, list all conversations (optionally filtered by lead)
    let query = supabase
      .from('conversations')
      .select(`
        id,
        channel,
        created_at,
        is_human_mode,
        lead:leads(id, first_name, last_name),
        messages(id, content, role, created_at)
      `)
      .eq('property_id', propertyId)
    
    if (leadId) {
      query = query.eq('lead_id', leadId)
    }
    
    const { data: conversations, error } = await query
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Process conversations to get preview and message count
    const processedConversations = (conversations || []).map(conv => {
      const messages = conv.messages || []
      const lastMessage = messages.sort((a, b) =>
        safeTimestamp(b.created_at) - safeTimestamp(a.created_at)
      )[0]
      const lastMessageContent = lastMessage?.content ?? ''

      return {
        id: conv.id,
        channel: conv.channel,
        created_at: conv.created_at,
        is_human_mode: conv.is_human_mode,
        human_agent_id: null,
        lead: conv.lead,
        messageCount: messages.length,
        lastMessage: lastMessage ? {
          content: lastMessageContent.slice(0, 50) + (lastMessageContent.length > 50 ? '...' : ''),
          role: lastMessage.role,
          created_at: lastMessage.created_at,
        } : null,
      }
    })

    return NextResponse.json({ conversations: processedConversations })
  } catch (error) {
    console.error('Conversations API error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE - Delete a conversation
export async function DELETE(req: NextRequest) {
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversationId')

  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, property_id')
      .eq('id', conversationId)
      .single()

    if (conversationError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (typeof conversation.property_id !== 'string') {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, conversation.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete messages first (due to FK constraint)
    await supabase
      .from('messages')
      .delete()
      .eq('conversation_id', conversationId)

    // Delete conversation
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Conversation delete error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

