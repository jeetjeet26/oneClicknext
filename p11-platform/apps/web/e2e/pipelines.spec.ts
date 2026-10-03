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
test('request, stop, retry and inspect actual saved worker results', async ({ page, fixture: f }, info) => {
    await login(page, f);
    await start(page);
    const first = (await jobs(f))[0];
    await selected(page).getByLabel('Decision note (optional)').fill('Paused while checking source data');
    await selected(page).getByRole('button', { name: 'Stop import', exact: true }).click();
    await expect(panel(page).getByRole('status')).toContainText('Import stopped');
    await expect(selected(page).getByRole('heading', { name: 'Stopped import', exact: true })).toBeVisible();
    await selected(page).getByRole('button', { name: 'Request linked retry' }).click();
    await expect(selected(page).getByRole('heading', { name: 'Queued import', exact: true })).toBeVisible();
    const rows = await jobs(f);
    expect(rows).toHaveLength(2);
    expect(rows[1].retry_of).toBe(first.id);
    expect(rows[1].reference_at).toBe(first.reference_at);
    finish(f, rows[1].id);
    await selected(page).getByRole('button', { name: 'Refresh selected import' }).click();
    await expect(selected(page).getByRole('heading', { name: 'Completed import', exact: true })).toBeVisible();
    await expect(selected(page).getByRole('region', { name: 'Saved account progress' })).toContainText('Source rows: 1 · Saved: 1 · Account finished');
    await expect(selected(page)).toContainText('Worker finished · Import worker');
    await selected(page).getByLabel('Decision note (optional)').fill('One confirmed source row reviewed');
    await selected(page).getByRole('button', { name: 'Record progress review' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Progress review saved');
    await expect(selected(page)).toContainText('One confirmed source row reviewed');
    const events = await f.db.from('shared_action_events').select('action,actor_id,service_principal,training_eligible').eq('property_id', f.property).like('action', 'pipeline.%');
    expect(events.error).toBeNull();
    expect(events.data!.some(e => e.service_principal === 'pipelines.import_worker')).toBe(true);
    expect(events.data!.every(e => !e.training_eligible)).toBe(true);
    await selected(page).getByRole('heading').first().evaluate(e => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('pipelines-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('pipelines-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('lost request reply recovers only the saved identity without a second job', async ({ page, fixture: f }) => {
    await login(page, f);
    let lost = true;
    await page.route('**/api/pipelines/controls', async (route) => {
        if (lost && route.request().postDataJSON()?.operation === 'start') {
            lost = false;
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    await page.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' }).check();
    await page.getByRole('button', { name: 'Request import', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Unconfirmed import request' })).toBeVisible();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('p11.pipeline.v1:')).map(([, v]) => JSON.parse(v)));
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0])).toEqual(['id']);
    await page.reload();
    await page.getByRole('button', { name: 'Check request result' }).click();
    await expect(selected(page).getByRole('heading', { name: 'Queued import' })).toBeVisible();
    expect(await jobs(f)).toHaveLength(1);
});
test('unused cancellation fences a delayed original start', async ({ page, fixture: f }) => {
    await login(page, f);
    let original: unknown;
    await page.route('**/api/pipelines/controls', async (route) => {
        if (route.request().postDataJSON()?.operation === 'start') {
            original = route.request().postDataJSON();
            await route.abort();
        }
        else
            await route.continue();
    });
    await page.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' }).check();
    await page.getByRole('button', { name: 'Request import', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel unused request' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Unused request cancelled');
    await page.unroute('**/api/pipelines/controls');
    const late = await page.request.post('/api/pipelines/controls', { headers: { origin }, data: original });
    expect((await late.json()).status).toBe('cancelled_request');
    expect(await jobs(f)).toHaveLength(0);
});
test('lost stop response recovers the stopped job after reload', async ({ page, fixture: f }) => {
    await login(page, f);
    await start(page);
    await page.route('**/api/pipelines/controls', async (route) => {
        if (route.request().postDataJSON()?.operation === 'stop') {
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    await selected(page).getByRole('button', { name: 'Stop import', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Check request result' }).click();
    await expect(selected(page).getByRole('heading', { name: 'Stopped import' })).toBeVisible();
    expect((await jobs(f))[0].status).toBe('cancelled');
});
test('stale progress cannot be overwritten and a viewer cannot act from an old tab', async ({ page, fixture: f }) => {
    await login(page, f);
    await start(page);
    const first = (await jobs(f))[0];
    expect((await decision(f, page, 'stop', first)).status()).toBe(200);
    await selected(page).getByRole('button', { name: 'Stop import', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('The import changed');
    await page.getByRole('button', { name: 'Cancel unused request' }).click();
    await expect(selected(page).getByRole('heading', { name: 'Stopped import' })).toBeVisible();
    sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`);
    expect((await decision(f, page, 'retry', (await jobs(f))[0])).status()).toBe(403);
    await page.reload();
    await expect(panel(page)).toContainText('An administrator or manager can request');
    await expect(page.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' })).toBeDisabled();
    await history(page).getByRole('button').filter({ hasText: 'Stopped' }).click();
    await expect(selected(page).getByRole('button', { name: 'Request linked retry' })).toBeDisabled();
});
test('complete job and decision history remains paged and legacy jobs stay distinct', async ({ page, fixture: f }) => {
    sql(`INSERT INTO import_jobs(property_id,channels,date_range,status,created_at)SELECT '${f.property}',ARRAY['google_ads'],'LAST_7_DAYS','complete',clock_timestamp()-make_interval(days=>n)FROM generate_series(1,45)n;`);
    await login(page, f);
    await expect(history(page)).toContainText('1–20 of 45');
    await history(page).getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(history(page)).toContainText('21–40 of 45');
    await history(page).getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(history(page)).toContainText('41–45 of 45');
    await history(page).getByRole('button').filter({ hasText: 'Completed · Google Ads' }).last().click();
    await expect(selected(page)).toContainText('Historical import');
    await expect(selected(page).getByRole('button', { name: 'Request linked retry' })).toHaveCount(0);
    const legacy = (await jobs(f))[0];
    for (let n = 0; n < 22; n++)
        expect((await decision(f, page, 'review', legacy)).status()).toBe(200);
    await selected(page).getByRole('button', { name: 'Refresh selected import' }).click();
    const h = selected(page).getByRole('region', { name: 'Import decision history' });
    await expect(h).toContainText('1–20 of 22');
    await h.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(h).toContainText('21–22 of 22');
});
test('failed refresh preserves last-known records with an explicit warning', async ({ page, fixture: f }) => {
    await login(page, f);
    await start(page);
    await page.route('**/api/pipelines/controls?*', route => route.fulfill({ status: 503, json: { error: 'Import service unavailable' } }));
    await page.getByRole('button', { name: 'Refresh imports', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('Previously loaded progress may be out of date');
    await expect(history(page)).toContainText('Queued · Google Ads');
    await page.unroute('**/api/pipelines/controls?*');
    await page.getByRole('button', { name: 'Refresh imports', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    expect(await jobs(f)).toHaveLength(1);
});
test('disabled browser storage prevents an untracked import', async ({ page, fixture: f }) => {
    await login(page, f);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); }; });
    await page.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' }).check();
    await page.getByRole('button', { name: 'Request import', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('Storage unavailable');
    expect(await jobs(f)).toHaveLength(0);
});
test('BI opens the recorded import controls without starting a job', async ({ page, fixture: f }) => {
    await login(page, f);
    await page.getByRole('link', { name: 'Open MultiChannel BI' }).click();
    await page.getByRole('button', { name: 'Import Data' }).click();
    await page.getByRole('link', { name: 'Import connected accounts' }).click();
    await expect(page).toHaveURL(/dashboard\/pipelines/);
    expect(await jobs(f)).toHaveLength(0);
});
test('changed account selection is held and a later source change explains the worker hold', async ({ page, fixture: f }) => {
    await login(page, f);
    await page.getByRole('checkbox', { name: 'Synthetic Search account · Google Ads' }).check();
    sql(`UPDATE ad_account_connections SET account_id='3333333333' WHERE id='${f.connection}';`);
    await page.getByRole('button', { name: 'Request import', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('A selected account changed');
    expect(await jobs(f)).toHaveLength(0);
    await page.getByRole('button', { name: 'Cancel unused request' }).click();
    await expect(panel(page)).toContainText('Account 3333333333');
    await page.getByRole('button', { name: 'Request import', exact: true }).click();
    await expect(selected(page).getByRole('heading', { name: 'Queued import' })).toBeVisible();
    await expect(selected(page)).toContainText('Google Ads · 3333333333');
    sql(`UPDATE ad_account_connections SET is_active=false WHERE id='${f.connection}';`);
    await selected(page).getByRole('button', { name: 'Refresh selected import' }).click();
    await expect(selected(page).getByRole('status')).toContainText('A source connection changed or is inactive');
    await selected(page).getByRole('button', { name: 'Stop import', exact: true }).click();
    await expect(selected(page).getByRole('heading', { name: 'Stopped import' })).toBeVisible();
});
