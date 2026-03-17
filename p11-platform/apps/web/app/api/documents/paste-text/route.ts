import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { upsertManagedKnowledgeSource } from '@/utils/services/knowledge-sources'
import OpenAI from 'openai'

const MAX_CHUNK = 800
const CHUNK_OVERLAP = 100

// Smarter chunking that tries to break at sentence boundaries
function chunkText(text: string, maxSize = MAX_CHUNK, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  
  let currentChunk = ''
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      // Keep some overlap for context
      const words = currentChunk.split(' ')
      const overlapWords = words.slice(-Math.floor(overlap / 5))
      currentChunk = overlapWords.join(' ') + ' ' + sentence
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }
  
  return chunks.filter(chunk => chunk.length > 50) // Filter out tiny chunks
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { content, propertyId, title } = body

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    if (content.trim().length < 50) {
      return NextResponse.json({ 
        error: 'Content too short - please provide at least 50 characters' 
      }, { status: 400 })
    }

    if (content.length > 100000) {
      return NextResponse.json({ 
        error: 'Content too long - maximum 100,000 characters' 
      }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()

    const documentTitle = title || 'Pasted Text Content'
    
    // Clean up text
    const textContent = content
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s{2,}/g, ' ')
      .trim()

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // Chunk the text
    const chunks = chunkText(textContent)

    if (chunks.length === 0) {
      return NextResponse.json({ 
        error: 'Could not create text chunks from content' 
      }, { status: 400 })
    }

    // Generate embeddings
    const BATCH_SIZE = 100
    const allEmbeddings: number[][] = []

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      })
      allEmbeddings.push(...embeddingResponse.data.map(e => e.embedding))
    }

    // Store document chunks with embeddings
    const payload = chunks.map((chunk, idx) => ({
      content: chunk,
      metadata: { 
        title: documentTitle,
        source: 'pasted_text',
        chunk_index: idx,
        total_chunks: chunks.length,
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
      },
      property_id: propertyId,
      embedding: allEmbeddings[idx],
    }))

    // Insert into database
    const { error: insertError } = await supabase.from('documents').insert(payload as never)
    
    if (insertError) {
      console.error('Document insert error:', insertError)
      return NextResponse.json({ error: 'Failed to store document' }, { status: 500 })
    }

    try {
      await upsertManagedKnowledgeSource(supabase, {
        propertyId,
        sourceType: 'manual',
        sourceName: 'Pasted Text Content',
        status: 'completed',
        documentsCreated: chunks.length,
        extractedData: {
          brand_origin: 'client_provided_material',
          method: 'paste_text',
          title: documentTitle,
          content_length: textContent.length,
        },
      })
    } catch (knowledgeSourceError) {
      console.error('Knowledge source upsert error:', knowledgeSourceError)
      return NextResponse.json(
        { error: 'Failed to create knowledge source record for pasted text' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      title: documentTitle,
      chunks: chunks.length,
      characters: textContent.length,
    })
  } catch (error) {
    console.error('Paste text error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Server error' 
    }, { status: 500 })
  }
}
