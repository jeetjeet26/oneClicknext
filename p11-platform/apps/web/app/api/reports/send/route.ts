import { NextResponse, type NextRequest } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/utils/supabase/admin';
import { validateCronAuth } from '@/utils/services/api-helpers';
import { isDeliveryPaused, DELIVERY_PAUSED_MESSAGE } from '@/utils/services/delivery-guard';
import { processBiSchedule } from '@/utils/analytics/schedule-worker';
import { teamHeaders as headers } from '@/utils/team/http';
export const runtime = 'nodejs';
const allowed = () => !isDeliveryPaused() && process.env.BI_SCHEDULE_DELIVERY_ENABLED === 'true';
export async function POST(request: NextRequest) {
    const authError = validateCronAuth(request);
    if (authError)
        return authError;
    if (!allowed())
        return NextResponse.json({ error: DELIVERY_PAUSED_MESSAGE }, { status: 503, headers });
    const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
    if (!key || !from)
        return NextResponse.json({ error: 'Report email delivery is not configured' }, { status: 503, headers });
    const db = createServiceClient(), provider = new Resend(key);
    try {
        const { data, error } = await db.from('bi_schedules').select('id').eq('state', 'active').lte('next_run_at', new Date().toISOString()).order('next_run_at', { ascending: true }).limit(10);
        if (error)
            throw error;
        const results = [];
        for (const schedule of data || []) {
            try {
                results.push(await processBiSchedule(schedule.id, from, async (payload, idempotencyKey) => { const r = await provider.emails.send(payload, { idempotencyKey }); return r.error ? null : r.data?.id || null; }, db, allowed));
            }
            catch {
                results.push({ scheduleId: schedule.id, status: 'unconfirmed' });
            }
        }
        return NextResponse.json({ processed: results.length, results }, { headers });
    }
    catch {
        return NextResponse.json({ error: 'Report processing could not be confirmed. Review schedule history before recovery.' }, { status: 503, headers });
    }
}
export async function GET(request: NextRequest) {
    const authError = validateCronAuth(request);
    if (authError)
        return authError;
    return NextResponse.json({ deliveryPaused: !allowed(), message: 'Use property schedule history to inspect retained runs and recipient outcomes.' }, { headers });
}
