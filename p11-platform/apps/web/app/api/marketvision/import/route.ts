import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { normalizeImportJobRecord } from '@/utils/marketvision/import-job-state';
import { IMPORT_UUID } from '@/utils/marketvision/import-request';
const headers = { 'Cache-Control': 'private, no-store' };
const JOB_FIELDS = 'id, property_id, channels, date_range, status, progress_pct, current_step, records_imported, campaigns_found, error_message, started_at, completed_at, created_at, recovery_version, attempts, lease_expires_at';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function POST() { return reply({ error: 'Open Pipelines to select accounts and record an import request.', next: '/dashboard/pipelines' }, 410); }
export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user)
        return reply({ error: 'Unauthorized' }, 401);
    const params = new URL(request.url).searchParams;
    const jobId = params.get('job_id');
    const propertyId = params.get('property_id');
    if ((!jobId && !propertyId) || (jobId && !IMPORT_UUID.test(jobId)) || (propertyId && !IMPORT_UUID.test(propertyId)))
        return reply({ error: 'A valid job_id or property_id is required.' }, 400);
    try {
        if (propertyId && !(await validatePropertyAccess(user.id, propertyId)).authorized)
            return reply({ error: 'Forbidden' }, 403);
        if (jobId) {
            let query = supabase.from('import_jobs').select(JOB_FIELDS).eq('id', jobId);
            if (propertyId)
                query = query.eq('property_id', propertyId);
            const { data: job, error } = await query.maybeSingle();
            if (error)
                return reply({ error: 'Import status is unavailable. Try again.' }, 503);
            if (!job?.property_id)
                return reply({ error: 'No recorded job was found for this request.' }, 404);
            if (!propertyId && !(await validatePropertyAccess(user.id, job.property_id)).authorized)
                return reply({ error: 'Forbidden' }, 403);
            return reply({ job: normalizeImportJobRecord(job) });
        }
        const { data, error } = await supabase.from('import_jobs').select(JOB_FIELDS)
            .eq('property_id', propertyId!).order('created_at', { ascending: false }).limit(10);
        if (error || !Array.isArray(data))
            return reply({ error: 'Import status is unavailable. Try again.' }, 503);
        return reply({ job: data.map(normalizeImportJobRecord) });
    }
    catch {
        return reply({ error: 'Import status is unavailable. Try again.' }, 503);
    }
}
