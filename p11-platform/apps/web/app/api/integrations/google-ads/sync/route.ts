import { NextResponse } from 'next/server';
import { queueAdConnection } from '@/utils/marketvision/queue-ad-connection';
// Compatibility entry point: native/scheduled imports share the qualified daily
// provider readers, persisted report checkpoints and worker leases.
export async function syncGoogleAdsConnection(connectionId: string, accountId: string, propertyId: string, daysBack = 7) {
    return queueAdConnection('google_ads', connectionId, accountId, propertyId, daysBack);
}
export async function POST() { return NextResponse.json({ error: 'Open Pipelines to review accounts and record this import.', next: '/dashboard/pipelines' }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } }); }
