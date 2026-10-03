/**
 * PropertyAudit Site Findings API
 * Occurrence-counted technical findings from the full-site crawl,
 * with a discovered/fixed task lifecycle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
const VALID_STATUSES = ['todo', 'in_progress', 'fixed', 'wont_fix'] as const;
type FindingStatus = (typeof VALID_STATUSES)[number];
// GET: List findings for a property with optional filters
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const searchParams = req.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId');
        const category = searchParams.get('category');
        const status = searchParams.get('status');
        const severity = searchParams.get('severity');
        const includeFixed = searchParams.get('includeFixed') === 'true';
        if (!propertyId) {
            return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
        }
        const access = await validatePropertyAccess(user.id, propertyId);
        if (!access.authorized) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const serviceClient = createServiceClient();
        let query = serviceClient
            .from('geo_site_findings')
            .select('*')
            .eq('property_id', propertyId)
            .order('first_detected_at', { ascending: false });
        if (category)
            query = query.eq('category', category);
        if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
            query = query.eq('status', status as FindingStatus);
        }
        else if (!includeFixed) {
            query = query.neq('status', 'fixed');
        }
        if (severity)
            query = query.eq('severity', severity as 'critical' | 'high' | 'medium' | 'low' | 'info');
        const { data: findings, error } = await query;
        if (error) {
            console.error('[Findings] Query error:', error);
            return NextResponse.json({ error: 'Failed to load findings' }, { status: 500 });
        }
        // Latest crawl status for the header card
        const { data: latestCrawl } = await serviceClient
            .from('geo_site_crawls')
            .select('id, status, seed_url, page_cap, pages_crawled, started_at, finished_at, error_message')
            .eq('property_id', propertyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const summary = {
            total: findings?.length || 0,
            byStatus: countBy(findings || [], 'status'),
            bySeverity: countBy(findings || [], 'severity'),
            byCategory: countBy(findings || [], 'category'),
            totalOccurrences: (findings || []).reduce((sum, finding) => sum + (Number(finding.occurrences) || 0), 0),
        };
        return NextResponse.json({
            findings: findings || [],
            summary,
            latestCrawl: latestCrawl || null,
            propertyId,
        });
    }
    catch (error) {
        console.error('PropertyAudit Findings GET Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
// PATCH: Update a finding's lifecycle fields (status, owner, notes)
export async function PATCH() { return NextResponse.json({ error: 'Use reviewed audit decisions. Saved questions, results and source evidence are retained.' }, { status: 410 }); }
function countBy(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        const value = String(row[key] ?? 'unknown');
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
