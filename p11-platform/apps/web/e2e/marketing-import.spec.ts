import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-pipeline-fixture-password';
const service = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(input: string) { return execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'pipe', 'pipe'] }); }
type Fixture = {
    id: string;
    email: string;
    org: string;
    property: string;
    db: ReturnType<typeof service>;
    today: string;
    connection: string;
};
const test = base.extend<{
    fixture: Fixture;
}>({ fixture: async ({}, provide) => {
        if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname))
            throw new Error('Local disposable fixtures only');
        const db = service(), email = 'pipeline-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID(), connection = randomUUID(), today = new Date().toISOString().slice(0, 10);
        try {
            sql(`BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','Pipeline browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin' WHERE id='${id}';INSERT INTO public.properties(id,org_id,name)VALUES('${property}','${org}','Pipeline fixture property');INSERT INTO public.ad_account_connections(id,property_id,platform,account_id,account_name,is_active)VALUES('${connection}','${property}','google_ads','1111111111','Synthetic Search account',true);COMMIT;`);
            await provide({ id, email, org, property, db, today, connection });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM public.fact_marketing_performance WHERE property_id='${property}';DELETE FROM public.properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer' WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
const panel = (p: Page) => p.getByRole('main', { name: 'Import controls' }), selected = (p: Page) => p.getByRole('region', { name: 'Selected import' }), history = (p: Page) => p.getByRole('region', { name: 'Import history', exact: true });
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fpipelines'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/pipelines/, { timeout: 30000 }); await expect(p.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' })).toBeVisible(); }
async function start(p: Page) { await p.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' }).check(); await p.getByRole('button', { name: 'Request import', exact: true }).click(); await expect(panel(p).getByRole('status')).toContainText('Import request recorded'); await expect(selected(p).getByRole('heading', { name: 'Queued import', exact: true })).toBeVisible(); }
async function jobs(f: Fixture) { const r = await f.db.from('import_jobs').select('*').eq('property_id', f.property).order('created_at'); expect(r.error).toBeNull(); return r.data!; }
async function decision(f: Fixture, p: Page, operation: string, job: Record<string, unknown>) { return p.request.post('/api/pipelines/controls', { headers: { origin }, data: { propertyId: f.property, expectedActorId: f.id, id: randomUUID(), operation, jobId: job.id, revision: job.revision, note: 'Concurrent decision' } }); }
function finish(f: Fixture, id: string) { const token = randomUUID(); sql(`SELECT public.claim_marketing_import('${id}','${token}');SELECT public.save_marketing_import_report('${id}','${token}','${f.connection}',jsonb_build_array(jsonb_build_object('date','${f.today}','property_id','${f.property}','channel_id','google_ads','source_account_id','1111111111','currency_code','USD','campaign_id','fixture','campaign_name','Synthetic campaign','impressions',100,'clicks',10,'spend',1.25,'conversions',0.125)));SELECT public.commit_marketing_import_batch('${id}','${token}','${f.connection}');SELECT public.finish_marketing_import('${id}','${token}');`); }
test('old manual entry points direct to reviewed controls without creating work', async ({ page, fixture: f }) => {
    await login(page, f);
    for (const path of ['/api/marketvision/import', '/api/integrations/google-ads/sync', '/api/integrations/meta-ads/sync']) {
        const r = await page.request.post(path, { headers: { origin }, data: { property_id: f.property, job_id: randomUUID(), channels: ['google_ads'], date_range: 'LAST_7_DAYS' } });
        expect(r.status()).toBe(410);
        expect((await r.json()).next).toBe('/dashboard/pipelines');
    }
    expect(await jobs(f)).toHaveLength(0);
});
test('previous job lookup remains authenticated and exact-property scoped', async ({ page, request, fixture: f }) => {
    await login(page, f);
    await start(page);
    const j = (await jobs(f))[0];
    expect((await request.get(`/api/marketvision/import?job_id=${j.id}`)).status()).toBe(401);
    const r = await page.request.get(`/api/marketvision/import?job_id=${j.id}&property_id=${f.property}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).job).toMatchObject({ id: j.id, status: 'pending', is_terminal: false });
    expect((await page.request.get(`/api/marketvision/import?job_id=${j.id}&property_id=${randomUUID()}`)).status()).toBe(403);
});
test('idle visible imports refresh from saved worker results', async ({ page, fixture: f }) => {
    await page.clock.install();
    await login(page, f);
    await start(page);
    finish(f, (await jobs(f))[0].id);
    await page.clock.fastForward(15001);
    await expect(selected(page).getByRole('heading', { name: 'Completed import' })).toBeVisible();
    await expect(history(page)).toContainText('Completed · Google Ads');
});
test('polling preserves a written decision note until an explicit refresh', async ({ page, fixture: f }) => {
    await page.clock.install();
    await login(page, f);
    await start(page);
    await selected(page).getByLabel('Decision note (optional)').fill('Keep this explanation');
    finish(f, (await jobs(f))[0].id);
    await page.clock.fastForward(15001);
    await expect(selected(page).getByLabel('Decision note (optional)')).toHaveValue('Keep this explanation');
    await expect(selected(page).getByRole('heading', { name: 'Queued import' })).toBeVisible();
    await selected(page).getByRole('button', { name: 'Record progress review' }).click();
    await expect(panel(page).getByRole('alert')).toContainText('The import changed');
    expect((await jobs(f))[0].status).toBe('complete');
});
