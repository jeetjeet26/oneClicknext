// Fixture reporting dates follow the browser calendar, including the UTC/local midnight boundary.
import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-bi-query-fixture-password';
const service = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(input: string) { return execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'pipe', 'pipe'] }); }
type Fixture = {
    id: string;
    email: string;
    org: string;
    property: string;
    db: ReturnType<typeof service>;
    today: string;
};
const test = base.extend<{
    fixture: Fixture;
}>({ fixture: async ({page}, provide) => {
        if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname))
            throw new Error('Local disposable fixtures only');
        const db = service(), email = 'bi-query-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID(), today = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; });
        try {
            sql(`BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','BI query browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin' WHERE id='${id}';INSERT INTO public.properties(id,org_id,name)VALUES('${property}','${org}','BI report fixture property');INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)SELECT '${property}','${today}','google_ads','1111111111','USD','campaign-'||n,CASE WHEN n=31 THEN '=SUM(2,3) "quoted" final campaign' ELSE 'Report campaign '||n END,100,10,10.01,0.125 FROM generate_series(0,31)n;INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)VALUES('${property}','${today}','google_ads','2222222222','USD','campaign-0','Report campaign 0 second account',0,0,0,0),('${property}','${today}'::date-30,'google_ads','1111111111','USD','prior','Prior zero baseline',0,0,0,0);COMMIT;`);
            await provide({ id, email, org, property, db, today });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM public.fact_marketing_performance WHERE property_id='${property}';DELETE FROM public.properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer' WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
const panel = (p: Page) => p.getByRole('region', { name: 'Marketing queries', exact: true }), selected = (p: Page) => panel(p).getByRole('region', { name: 'Selected marketing query' }), results = (p: Page) => selected(p).getByRole('region', { name: 'Query results' });
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fbi'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/bi/, { timeout: 30000 }); await expect(panel(p).getByRole('button', { name: 'Refresh queries' })).toBeEnabled({ timeout: 30000 }); }
async function prepare(p: Page, name = 'Saved campaign report', group = 'campaign') { await panel(p).getByLabel('Report name or question').fill(name); await panel(p).getByRole('combobox', { name: 'Group results by', exact: true }).selectOption(group); await panel(p).getByRole('button', { name: 'Prepare query', exact: true }).click(); await expect(selected(p)).toContainText('Plan ready for review'); }
async function row(f: Fixture) { const r = await f.db.from('bi_queries').select('*').eq('property_id', f.property).single(); expect(r.error).toBeNull(); return r.data!; }
async function rpc(f: Fixture, name: string, args: Record<string, unknown>) { const r = await f.db.rpc(name, args); expect(r.error, JSON.stringify(r.error)).toBeNull(); return r.data; }
const read = (f: Fixture, kind = 'list', id?: string) => '/api/analytics/query?' + new URLSearchParams({ propertyId: f.property, kind, ...(id ? { id } : {}) });
test('reviewed query calculates all campaigns, preserves original figures and pages every result', async ({ page, fixture: f }, info) => {
    await login(page, f);
    await expect(panel(page)).toContainText('Question interpretation is paused');
    await prepare(page);
    const initial = await row(f);
    expect(initial.result).toBeNull();
    expect(initial.claim_token).toBeNull();
    await selected(page).getByRole('combobox', { name: 'Reviewed grouping' }).selectOption('channel');
    await expect(selected(page).getByRole('button', { name: 'Calculate saved plan' })).toBeDisabled();
    await selected(page).getByRole('button', { name: 'Save reviewed plan' }).click();
    await expect(selected(page)).toContainText('Revision 2');
    await selected(page).getByRole('combobox', { name: 'Reviewed grouping' }).selectOption('campaign');
    await selected(page).getByRole('button', { name: 'Save reviewed plan' }).click();
    await expect(selected(page)).toContainText('Revision 3');
    sql(`UPDATE fact_marketing_performance SET spend=99 WHERE property_id='${f.property}' AND date='${f.today}';`);
    await selected(page).getByRole('button', { name: 'Calculate saved plan' }).click();
    await expect(results(page)).toContainText('Spend: $320.32');
    await expect(results(page)).toContainText('1–25 of 33');
    await results(page).getByRole('button', { name: 'Next page' }).click();
    await expect(results(page)).toContainText('26–33 of 33');
    const q = await row(f);
    expect(q.result.rows).toHaveLength(33);
    expect(q.result.totals).toMatchObject({ spend: 320.32, conversions: 4 });
    expect(q.result.rows.some((r: {
        label: string;
    }) => r.label.includes('final campaign'))).toBe(true);
    expect(q.source.currentRows[0].spend).not.toBe(99);
    await expect(selected(page).getByRole('region', { name: 'Query decision history' })).toContainText('Before: Channel');
    const actions = await f.db.from('shared_action_events').select('action,training_eligible').eq('property_id', f.property).like('action', 'bi.query.%');
    expect(actions.data).toHaveLength(4);
    expect(actions.data?.every(a => !a.training_eligible)).toBe(true);
    await results(page).getByRole('heading', { name: 'Calculated results' }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('queries-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await results(page).getByRole('heading', { name: 'Calculated results' }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('queries-mobile.png') });
});
test('lost prepared response recovers from identity only after reload', async ({ page, fixture: f }) => {
    await login(page, f);
    await panel(page).getByLabel('Report name or question').fill('Recover prepared query');
    let lost = false;
    await page.route('**/api/analytics/query', async (route) => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'request' && !lost) {
            lost = true;
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    await panel(page).getByRole('button', { name: 'Prepare query', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    const raw = await page.evaluate(({ id, property }) => JSON.parse(sessionStorage.getItem(`p11.bi-query.v1:${id}:${property}`)!), { id: f.id, property: f.property });
    expect(Object.keys(raw)).toEqual(['id']);
    await page.reload();
    await panel(page).getByRole('button', { name: 'Check query request' }).click();
    await expect(selected(page)).toContainText('Plan ready for review');
    expect((await f.db.from('bi_queries').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(1);
});
test('lost calculation reply recovers the retained result and cannot run twice', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page, 'Recover calculated query', 'none');
    let command: Record<string, unknown> | undefined;
    await page.route('**/api/analytics/query', async (route) => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'execute') {
            command = route.request().postDataJSON();
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    await selected(page).getByRole('button', { name: 'Calculate saved plan' }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await page.reload();
    await panel(page).getByRole('button', { name: 'Check query request' }).click();
    await expect(results(page)).toContainText('Spend: $320.32');
    const again = await page.request.post('/api/analytics/query', { headers: { origin }, data: command });
    expect(again.ok()).toBe(true);
    expect((await again.json()).state).toBe('replayed');
    expect((await f.db.from('shared_action_events').select('id', { count: 'exact', head: true }).eq('property_id', f.property).eq('action', 'bi.query.executed')).count).toBe(1);
});
test('stale report source is held without losing the draft and unused request can be cancelled', async ({ page, fixture: f }) => {
    await login(page, f);
    await panel(page).getByLabel('Report name or question').fill('Stale source report');
    sql(`UPDATE fact_marketing_performance SET spend=99 WHERE property_id='${f.property}' AND date='${f.today}';`);
    await panel(page).getByRole('button', { name: 'Prepare query', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('Report data changed');
    await expect(panel(page).getByLabel('Report name or question')).toHaveValue('Stale source report');
    await panel(page).getByRole('button', { name: 'Cancel unused query request' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Unused query request cancelled');
    expect((await f.db.from('bi_queries').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(0);
});
test('stop retains cancelled history and removes execution controls', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    await selected(page).getByRole('button', { name: 'Stop query' }).click();
    await expect(selected(page)).toContainText('Cancelled');
    await expect(selected(page).getByRole('button', { name: 'Calculate saved plan' })).toHaveCount(0);
    expect((await row(f)).result).toBeNull();
    await page.reload();
    await panel(page).getByRole('region', { name: 'Saved query list' }).getByRole('button', { name: /Saved campaign report/ }).click();
    await expect(selected(page)).toContainText('Cancelled');
});
test('simulated interpretation retains receipt and requires review before calculation', async ({ page, fixture: f }) => {
    await login(page, f);
    const current = await (await page.request.get('/api/analytics/reports?' + new URLSearchParams({ propertyId: f.property, kind: 'current', startDate: f.today, endDate: f.today, compare: 'false' }))).json();
    const id = randomUUID();
    const request = await page.request.post('/api/analytics/query', { headers: { origin }, data: { operation: 'request', mode: 'assistant', question: 'Show totals by channel', propertyId: f.property, expectedActorId: f.id, id, filters: current.source.filters, sourceHash: current.sourceHash } });
    expect(request.ok()).toBe(true);
    expect((await row(f)).state).toBe('requested');
    const token = randomUUID();
    expect((await rpc(f, 'claim_bi_query', { p_id: id, p_claim_token: token })).state).toBe('started');
    expect((await rpc(f, 'prepare_bi_query', { p_id: id, p_claim_token: token, p_receipt: { plan: { groupBy: 'channel', startDate: f.today, endDate: f.today, channel: null }, raw: 'Synthetic plan; no provider call', providerId: 'fixture-query-receipt', model: 'fixture-model', usage: { totalTokens: 15 }, issue: null } })).status).toBe('review');
    await panel(page).getByRole('button', { name: 'Refresh queries' }).click();
    await panel(page).getByRole('region', { name: 'Saved query list' }).getByRole('button', { name: /Show totals by channel/ }).click();
    await expect(selected(page)).toContainText('fixture-query-receipt');
    expect((await row(f)).result).toBeNull();
    await selected(page).getByRole('button', { name: 'Calculate saved plan' }).click();
    await expect(results(page)).toContainText('Spend: $320.32');
    const records = await f.db.from('shared_action_events').select('actor_id,service_principal').eq('property_id', f.property).like('action', 'bi.query.interpretation%');
    expect(records.data).toHaveLength(2);
    expect(records.data?.every(r => r.actor_id === null && r.service_principal === 'bi.query_interpreter')).toBe(true);
});
test('saved results remain available after current source fails, but revoked access is denied', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    await selected(page).getByRole('button', { name: 'Calculate saved plan' }).click();
    await expect(results(page)).toBeVisible();
    const q = await row(f);
    await page.route('**/api/analytics/reports?**', route => route.fulfill({ status: 503, json: { error: 'Synthetic source failure' } }));
    await page.reload();
    await panel(page).getByRole('region', { name: 'Saved query list' }).getByRole('button', { name: /Saved campaign report/ }).click();
    await expect(results(page)).toContainText('Spend: $320.32');
    sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET org_id=NULL,role='viewer' WHERE id='${f.id}';COMMIT;`);
    const denied = await page.request.get(read(f, 'detail', q.id));
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain('Saved campaign report');
});
test('all saved queries are reachable through complete history pagination', async ({ page, fixture: f }) => {
    await login(page, f);
    const source = await rpc(f, 'bi_report_source', { p_actor_id: f.id, p_property_id: f.property, p_filters: { startDate: f.today, endDate: f.today, compare: false, channel: null, account: null } });
    for (let n = 1; n <= 21; n++) {
        const id = randomUUID();
        expect((await rpc(f, 'decide_bi_query', { p_id: id, p_actor_id: f.id, p_property_id: f.property, p_input: { operation: 'request', mode: 'manual', question: 'Saved report ' + n, sourceHash: source.sourceHash, filters: source.source.filters, plan: { groupBy: 'none', startDate: f.today, endDate: f.today, channel: null } }, p_result: null })).state).toBe('saved');
    }
    await panel(page).getByRole('button', { name: 'Refresh queries' }).click();
    const list = panel(page).getByRole('region', { name: 'Saved query list' });
    await expect(list).toContainText('1–20 of 21');
    await list.getByRole('button', { name: 'Next page' }).click();
    await expect(list).toContainText('21–21 of 21');
    await list.getByRole('button', { name: /Saved report 1 / }).click();
    await expect(selected(page)).toContainText('Saved report 1');
});
