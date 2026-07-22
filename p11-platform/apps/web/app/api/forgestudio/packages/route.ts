import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

// GET - List content packages for a property, with current revision,
// variants, and publication state for the review/calendar workspace.
export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    const status = searchParams.get('status')
    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    let query = supabase
      .from('social_content_packages')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (status) {
      query = query.eq('status', status)
    }

    const { data: packages, error } = await query
    if (error) {
      console.error('Error listing packages:', error)
      return NextResponse.json({ error: 'Failed to list packages' }, { status: 500 })
    }

    const currentRevisionIds = (packages ?? [])
      .map((pkg) => pkg.current_revision_id)
      .filter((id): id is string => Boolean(id))

    const [revisionsResult, variantsResult, publicationsResult] = await Promise.all([
      currentRevisionIds.length
        ? supabase.from('social_content_revisions').select('*').in('id', currentRevisionIds)
        : Promise.resolve({ data: [], error: null }),
      currentRevisionIds.length
        ? supabase.from('social_content_variants').select('*').in('revision_id', currentRevisionIds)
        : Promise.resolve({ data: [], error: null }),
      currentRevisionIds.length
        ? supabase.from('social_publications').select('*').in('revision_id', currentRevisionIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (revisionsResult.error || variantsResult.error || publicationsResult.error) {
      console.error('Error hydrating packages:', {
        revisions: revisionsResult.error,
        variants: variantsResult.error,
        publications: publicationsResult.error,
      })
      return NextResponse.json({ error: 'Failed to load package details' }, { status: 500 })
    }

    const revisionById = new Map((revisionsResult.data ?? []).map((row) => [row.id, row]))
    const variantsByRevision = new Map<string, unknown[]>()
    for (const variant of variantsResult.data ?? []) {
      const list = variantsByRevision.get(variant.revision_id) ?? []
      list.push(variant)
      variantsByRevision.set(variant.revision_id, list)
    }
    const publicationsByRevision = new Map<string, unknown[]>()
    for (const publication of publicationsResult.data ?? []) {
      const list = publicationsByRevision.get(publication.revision_id) ?? []
      list.push(publication)
      publicationsByRevision.set(publication.revision_id, list)
    }

    const hydrated = (packages ?? []).map((pkg) => ({
      ...pkg,
      currentRevision: pkg.current_revision_id
        ? revisionById.get(pkg.current_revision_id) ?? null
        : null,
      variants: pkg.current_revision_id
        ? variantsByRevision.get(pkg.current_revision_id) ?? []
        : [],
      publications: pkg.current_revision_id
        ? publicationsByRevision.get(pkg.current_revision_id) ?? []
        : [],
    }))

    return NextResponse.json({ packages: hydrated })
  } catch (error) {
    console.error('Packages GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
