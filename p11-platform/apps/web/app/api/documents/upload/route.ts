import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'
import { extractText } from 'unpdf'
import { upsertManagedKnowledgeSource } from '@/utils/services/knowledge-sources'
import { 
  uploadFileAsset, 
  STORAGE_BUCKETS,
  getMimeTypeFromExtension
} from '@/utils/storage'

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

// Extract text from PDF using unpdf (works in Node.js/serverless)
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const { text } = await extractText(buffer)
    // unpdf returns text as array of strings (one per page)
    if (Array.isArray(text)) {
      return text.join('\n\n')
    }
    return typeof text === 'string' ? text : String(text || '')
  } catch (error) {
    console.error('PDF extraction error:', error)
    throw new Error('Failed to extract text from PDF')
  }
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const propertyId = formData.get('propertyId') as string
    const title = formData.get('title') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check file type - PDF, TXT, MD supported
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf')
    const isTxt = file.type === 'text/plain' || file.name.endsWith('.txt')
    const isMd = file.type === 'text/markdown' || file.name.endsWith('.md')
    
    if (!isPdf && !isTxt && !isMd) {
      return NextResponse.json({ 
        error: 'Invalid file type. Supported: PDF, TXT, MD' 
      }, { status: 400 })
    }

    // Check file size (max 10MB)
    const MAX_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ 
        error: 'File too large. Maximum size is 10MB' 
      }, { status: 400 })
    }

    const supabase = createServiceClient()
    const documentTitle = title || file.name.replace(/\.[^/.]+$/, '')
    
    // =============================================
    // STEP 1: Store the original file in Supabase Storage
    // =============================================
    let originalFileUrl: string | undefined
    let originalFilePath: string | undefined
    
    try {
      const mimeType = file.type || getMimeTypeFromExtension(file.name)
      const uploadResult = await uploadFileAsset(file, {
        bucket: STORAGE_BUCKETS.DOCUMENTS,
        propertyId,
        folder: 'uploads',
        contentType: mimeType
      })
      
      if (uploadResult.success && uploadResult.publicUrl) {
        originalFileUrl = uploadResult.publicUrl
        originalFilePath = uploadResult.storagePath
        console.log(`Original file stored: ${originalFilePath}`)
      } else {
        console.warn('Failed to store original file, continuing with text extraction:', uploadResult.error)
      }
    } catch (uploadError) {
      console.warn('Error uploading original file, continuing with text extraction:', uploadError)
    }

    // =============================================
    // STEP 2: Extract text content for embeddings
    // =============================================
    let textContent: string
    
    if (isPdf) {
      const arrayBuffer = await file.arrayBuffer()
      textContent = await extractPdfText(arrayBuffer)
    } else {
      textContent = await file.text()
    }

    if (!textContent || textContent.trim().length < 50) {
      return NextResponse.json({ 
        error: 'Could not extract enough text from file' 
      }, { status: 400 })
    }

    // Clean up text
    textContent = textContent
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s{2,}/g, ' ')
      .trim()

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // Chunk the text
    const chunks = chunkText(textContent)

    if (chunks.length === 0) {
      return NextResponse.json({ 
        error: 'Could not create text chunks from file' 
      }, { status: 400 })
    }

    // =============================================
    // STEP 3: Generate embeddings
    // =============================================
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

    // =============================================
    // STEP 4: Store document chunks with embeddings
    // Include reference to original file
    // =============================================
    const payload = chunks.map((chunk, idx) => ({
      content: chunk,
      metadata: { 
        title: documentTitle,
        source: file.name,
        chunk_index: idx,
        total_chunks: chunks.length,
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
      },
      property_id: propertyId,
      embedding: allEmbeddings[idx],
      // New fields for original file reference
      original_file_url: originalFileUrl,
      original_file_path: originalFilePath,
      original_file_name: file.name,
      original_file_size: file.size,
      original_file_type: file.type || getMimeTypeFromExtension(file.name),
    }))

    // Insert into database
    const { error: insertError } = await supabase.from('documents').insert(payload as never)
    
    if (insertError) {
      console.error('Document insert error:', insertError)
      return NextResponse.json({ error: 'Failed to store document' }, { status: 500 })
    }

    let knowledgeSourceId: string
    try {
      const knowledgeSource = await upsertManagedKnowledgeSource(supabase, {
        propertyId,
        sourceType: 'document',
        sourceName: documentTitle,
        sourceUrl: originalFileUrl || null,
        fileName: file.name,
        fileType: file.type || getMimeTypeFromExtension(file.name),
        fileSize: file.size,
        status: 'completed',
        documentsCreated: chunks.length,
        extractedData: {
          brand_origin: 'client_provided_material',
          title: documentTitle,
          original_file_path: originalFilePath || null,
          uploaded_by: user.id,
          uploaded_at: new Date().toISOString(),
        },
      })
      knowledgeSourceId = knowledgeSource.id
    } catch (knowledgeSourceError) {
      console.error('Knowledge source upsert error:', knowledgeSourceError)
      return NextResponse.json(
        { error: 'Failed to create knowledge source record for uploaded document' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      filename: file.name,
      title: documentTitle,
      chunks: chunks.length,
      characters: textContent.length,
      knowledgeSourceId,
      originalFileUrl,
      originalFileStored: !!originalFileUrl,
    })
  } catch (error) {
    console.error('Document upload error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Server error' 
    }, { status: 500 })
  }
}

