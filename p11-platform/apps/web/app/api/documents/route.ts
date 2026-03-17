import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

function getDocumentMetadata(
  metadata: unknown
): { source?: string; title?: string } {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return metadata as { source?: string; title?: string }
}

// GET - List documents for a property
export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/documents')
  ctx.logStart()

  try {
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { searchParams } = new URL(req.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('propertyId is required', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden_property_access', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const supabase = createServiceClient()

    // Get unique documents by title/source
    const { data, error } = await supabase
      .from('documents')
      .select('id, content, metadata, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    if (error) {
      ctx.logError(500, error, { operation: 'list_documents' })
      return serverError(error, ctx.responseHeaders)
    }

    // Group by source file
    const groupedDocs = new Map<string, {
      id: string
      title: string
      source: string
      chunks: number
      created_at: string
      preview: string
    }>()

    for (const doc of data || []) {
      const metadata = getDocumentMetadata(doc.metadata)
      const source = metadata.source || metadata.title || 'Unknown'
      
      if (!groupedDocs.has(source)) {
        groupedDocs.set(source, {
          id: doc.id,
          title: metadata.title || source,
          source,
          chunks: 1,
          created_at: doc.created_at || new Date(0).toISOString(),
          preview: doc.content.slice(0, 200) + '...',
        })
      } else {
        const existing = groupedDocs.get(source)!
        existing.chunks += 1
      }
    }

    ctx.logSuccess(200, { documentCount: groupedDocs.size })

    return NextResponse.json(
      {
        documents: Array.from(groupedDocs.values()),
        total: groupedDocs.size,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'list_documents' })
    return serverError(error, ctx.responseHeaders)
  }
}

// DELETE - Remove a document and all its chunks
export async function DELETE(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/documents')
  ctx.logStart()

  try {
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { searchParams } = new URL(req.url)
    const source = searchParams.get('source')
    const propertyId = searchParams.get('propertyId')

    if (!source || !propertyId) {
      ctx.logSuccess(400, { reason: 'missing_source_or_property_id' })
      return badRequest('source and propertyId are required', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden_property_access', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const supabase = createServiceClient()

    // Delete all chunks with this source
    const { error, count } = await supabase
      .from('documents')
      .delete({ count: 'exact' })
      .eq('property_id', propertyId)
      .eq('metadata->>source', source)

    if (error) {
      ctx.logError(500, error, { operation: 'delete_document' })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, { deleted: count || 0, source })

    return NextResponse.json(
      { 
        success: true, 
        deleted: count || 0,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'delete_document' })
    return serverError(error, ctx.responseHeaders)
  }
}



























