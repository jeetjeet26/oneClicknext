import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { addRevision, ContentStoreError } from '@/utils/forgestudio/content-store'
import { revisionContentSchema } from '@/utils/forgestudio/content-contract'

const createRevisionSchema = z.object({
  content: revisionContentSchema,
})

async function resolvePackageProperty(packageId: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('social_content_packages')
    .select('id, property_id')
    .eq('id', packageId)
    .single()
  if (error || !data) return null
  return data
}

// GET - List revisions for a package (history view)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  try {
    const { packageId } = await params
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pkg = await resolvePackageProperty(packageId)
    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, pkg.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('social_content_revisions')
      .select('*')
      .eq('package_id', packageId)
      .order('revision_number', { ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Failed to list revisions' }, { status: 500 })
    }

    return NextResponse.json({ revisions: data ?? [] })
  } catch (error) {
    console.error('Revisions GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new (edited) revision. Supersedes prior approvals and
// cancels not-yet-published schedules for superseded revisions.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  try {
    const { packageId } = await params
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const parsed = createRevisionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid revision content', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const pkg = await resolvePackageProperty(packageId)
    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, pkg.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const revision = await addRevision(packageId, {
      content: parsed.data.content,
      author: { kind: 'user', userId: user.id },
    })

    return NextResponse.json({ revision }, { status: 201 })
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Revisions POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
