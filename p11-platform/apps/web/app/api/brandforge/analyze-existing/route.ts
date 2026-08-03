import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createBrandImportPreview } from '@/utils/brandforge/imports'

/**
 * Analyze existing knowledge base documents to extract brand insights
 * Used for properties that already have documents but no formal brand book
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { propertyId } = await req.json()

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: docs, error: docsError } = await supabase
      .from('documents')
      .select('id')
      .eq('property_id', propertyId)
      .limit(50)

    if (docsError || !docs || docs.length === 0) {
      return NextResponse.json({ 
        error: 'No documents found',
        hasDocs: false 
      }, { status: 404 })
    }

    const preview = await createBrandImportPreview({
      orgId: access.orgId!,
      propertyId,
      userId: user.id,
      sourceType: 'package',
      idempotencyKey: `legacy-analyze-${createHash('sha256').update(
        docs.map(doc => doc.id).sort().join(','),
      ).digest('hex')}`,
      documentIds: docs.map(doc => doc.id),
    })

    return NextResponse.json({
      success: true,
      preview,
      documentCount: docs.length
    })

  } catch (error) {
    console.error('Brand Analysis Error:', error)
    return NextResponse.json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}























