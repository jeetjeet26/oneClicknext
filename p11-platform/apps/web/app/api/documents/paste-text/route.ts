import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
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

    const supabase = createServiceClient()

    // Verify user has access to this property
    const { data: property } = await supabase
      .from('properties')
      .select('id, name, org_id')
      .eq('id', propertyId)
      .single()

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (profile?.org_id !== property.org_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

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
    const { error: insertError } = await supabase.from('documents').insert(payload)
    
    if (insertError) {
      console.error('Document insert error:', insertError)
      return NextResponse.json({ error: 'Failed to store document' }, { status: 500 })
    }

    // Create or update knowledge_sources entry for pasted text
    const { data: existingSource } = await supabase
      .from('knowledge_sources')
      .select('id, documents_created')
      .eq('property_id', propertyId)
      .eq('source_type', 'manual')
      .eq('source_name', 'Pasted Text Content')
      .single()

    if (existingSource) {
      // Update existing entry
      await supabase
        .from('knowledge_sources')
        .update({
          documents_created: (existingSource.documents_created || 0) + chunks.length,
          last_synced_at: new Date().toISOString(),
          status: 'completed'
        })
        .eq('id', existingSource.id)
    } else {
      // Create new entry
      await supabase
        .from('knowledge_sources')
        .insert({
          property_id: propertyId,
          source_type: 'manual',
          source_name: 'Pasted Text Content',
          status: 'completed',
          documents_created: chunks.length,
          extracted_data: {
            method: 'paste_text',
            title: documentTitle,
            content_length: textContent.length,
          },
          last_synced_at: new Date().toISOString()
        })
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
