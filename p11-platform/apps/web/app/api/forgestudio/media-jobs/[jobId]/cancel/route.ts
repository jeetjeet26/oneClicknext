import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { MEDIA_JOB_DOMAIN } from '@/utils/forgestudio/media-jobs'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await params
  const supabase = createServiceClient()
  const { data: job, error } = await supabase
    .from('shared_jobs')
    .select('id, property_id, lifecycle_status, domain')
    .eq('id', jobId)
    .eq('domain', MEDIA_JOB_DOMAIN)
    .single()
  if (error || !job?.property_id) {
    return NextResponse.json({ error: 'Media job not found' }, { status: 404 })
  }
  const access = await validatePropertyAccess(user.id, job.property_id)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (['succeeded', 'failed', 'cancelled'].includes(job.lifecycle_status)) {
    return NextResponse.json({ error: 'Media job is already terminal' }, { status: 409 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('shared_jobs')
    .update({
      cancel_requested: true,
      status_reason: 'cancel_requested',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('id, cancel_requested, lifecycle_status')
    .single()
  if (updateError || !updated) {
    return NextResponse.json({ error: 'Failed to request cancellation' }, { status: 500 })
  }
  return NextResponse.json({ job: updated })
}
