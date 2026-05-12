import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'
import { editPropertyChatbotContext } from '@/utils/services/chatbot-context-editor'

const MAX_CHUNK = 800

function chunkText(text: string, size = MAX_CHUNK): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + size))
    start += size
  }
  return chunks
}

export async function POST(req: NextRequest) {
  try {
    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { content, metadata, propertyId } = await req.json()

    if (!content || !propertyId) {
      return NextResponse.json({ error: 'content and propertyId are required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const supabase = createServiceClient()

    const chunks = chunkText(content)

    const embeddings = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: chunks,
    })

    const payload = chunks.map((chunk, idx) => ({
      content: chunk,
      metadata,
      property_id: propertyId,
      embedding: embeddings.data[idx].embedding,
    }))

    const { error } = await supabase.from('documents').insert(payload as never)
    if (error) {
      console.error(error)
      return NextResponse.json({ error: 'Failed to insert documents' }, { status: 500 })
    }

    try {
      const contextResult = await editPropertyChatbotContext(supabase, propertyId, {
        changeSummary: 'Raw document ingest updated chatbot context source material.',
        mode: 'source_change',
      })
      if (!contextResult.success) {
        console.error('Chatbot context edit failed after ingest:', contextResult.error)
      }
    } catch (contextError) {
      console.error('Chatbot context edit failed after ingest:', contextError)
    }

    return NextResponse.json({ inserted: payload.length })
  } catch (error) {
    console.error('Ingest API error', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}



























