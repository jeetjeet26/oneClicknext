// Fixture reporting dates follow the browser calendar, including the UTC/local midnight boundary.
import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-bi-alert-fixture-password';
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
        const db = service(), email = 'bi-alert-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID(), today = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; });
        try {
            sql(`BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','BI alert browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin' WHERE id='${id}';INSERT INTO public.properties(id,org_id,name)VALUES('${property}','${org}','BI report fixture property');INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)SELECT '${property}','${today}'::date-n,'google_ads','1111111111','USD','campaign-fixture','Synthetic alternating campaign',CASE WHEN n%2=0 THEN 1000 ELSE 0 END,CASE WHEN n%2=0 THEN 100 ELSE 0 END,CASE WHEN n%2=0 THEN 10 ELSE 0 END,CASE WHEN n%2=0 THEN 1 ELSE 0 END FROM generate_series(0,29)n;COMMIT;`);
            await provide({ id, email, org, property, db, today });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM public.fact_marketing_performance WHERE property_id='${property}';DELETE FROM public.properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer' WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
const panel = (p: Page) => p.getByRole('region', { name: 'Marketing change review', exact: true }), selected = (p: Page) => panel(p).getByRole('region', { name: 'Selected change review' });
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fbi'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/bi/, { timeout: 30000 }); await panel(p).getByRole('button', { name: 'Open change review' }).click(); await expect(panel(p).getByRole('button', { name: 'Save current changes for review' })).toBeEnabled({ timeout: 30000 }); }
async function prepare(p: Page) { await panel(p).getByRole('button', { name: 'Save current changes for review' }).click(); await expect(panel(p).getByRole('status')).toContainText('Changes saved for review'); await expect(selected(p)).toBeVisible(); }
async function sets(f: Fixture) { const r = await f.db.from('bi_alert_sets').select('*').eq('property_id', f.property).order('created_at'); expect(r.error).toBeNull(); return r.data!; }
async function allItems(f: Fixture, setId: string) { const r = await f.db.from('bi_alert_items').select('*').eq('set_id', setId).order('item_key'); expect(r.error).toBeNull(); return r.data!; }
test('save all changes, review with notes, dismiss, restore and inspect complete history', async ({ page, fixture: f }, info) => {
    await login(page, f);
    await expect(panel(page)).toContainText('120 changes meet the review thresholds');
    await prepare(page);
    await expect(selected(page)).toContainText('1–20 of 120');
    await selected(page).getByRole('button', { name: 'Select this page' }).click();
    await selected(page).getByLabel('Review note (optional)').fill('Expected campaign change');
    await selected(page).getByRole('button', { name: 'Mark selected reviewed' }).click();
    await expect(panel(page).getByRole('status')).toContainText('20 changes marked reviewed');
    await selected(page).getByRole('combobox', { name: 'Review status' }).selectOption('reviewed');
    await expect(selected(page)).toContainText('1–20 of 20');
    await selected(page).getByRole('button', { name: 'Select this page' }).click();
    await selected(page).getByLabel('Review note (optional)').fill('Campaign explained');
    await selected(page).getByRole('button', { name: 'Dismiss selected' }).click();
    await expect(panel(page).getByRole('status')).toContainText('20 changes marked dismissed');
    await selected(page).getByRole('combobox', { name: 'Review status' }).selectOption('dismissed');
    await selected(page).getByRole('button', { name: 'Select this page' }).click();
    await selected(page).getByRole('button', { name: 'Restore selected' }).click();
    await expect(panel(page).getByRole('status')).toContainText('20 changes marked open');
    const saved = (await sets(f))[0], items = await allItems(f, saved.id);
    expect(items).toHaveLength(120);
    expect(items.every(i => i.state === 'open')).toBe(true);
    expect(items.slice(0, 20).every(i => i.revision === 4)).toBe(true);
    const history = panel(page).getByRole('region', { name: 'Change decision history' });
    await expect(history).toContainText('Expected campaign change');
    expect((await f.db.from('shared_action_events').select('id', { count: 'exact', head: true }).eq('property_id', f.property).like('action', 'bi.alert.%')).count).toBe(4);
    for (let n = 0; n < 5; n++)
        await selected(page).getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(selected(page)).toContainText('101–120 of 120');
    await expect(selected(page).getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await selected(page).getByRole('heading').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('alerts-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await selected(page).getByRole('heading').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('alerts-mobile.png') });
});
test('lost review response recovers the exact selection and stores only request identity', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    await selected(page).getByRole('checkbox').first().check();
    await selected(page).getByLabel('Review note (optional)').fill('Keep this exact explanation');
    let lost = false;
    await page.route('**/api/analytics/alerts', async (route) => { if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'review' && !lost) {
        lost = true;
        await route.fetch();
        await route.abort();
    }
    else
        await route.continue(); });
    await selected(page).getByRole('button', { name: 'Mark selected reviewed' }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    const raw = await page.evaluate(({ id, property }) => JSON.parse(sessionStorage.getItem(`p11.bi-alert.v1:${id}:${property}`)!), { id: f.id, property: f.property });
    expect(Object.keys(raw)).toEqual(['id']);
    await page.reload();
    await panel(page).getByRole('button', { name: 'Check change review request' }).click();
    await expect(panel(page).getByRole('status')).toContainText('1 change marked reviewed');
    await expect(selected(page)).toContainText('Keep this exact explanation');
    expect((await f.db.from('bi_alert_commands').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(2);
});
test('unused preparation cancellation fences the delayed request without a duplicate catalog', async ({ page, fixture: f }) => {
    await login(page, f);
    let command: Record<string, unknown> | undefined;
    await page.route('**/api/analytics/alerts', async (route) => { if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'prepare') {
        command = route.request().postDataJSON();
        await route.abort();
    }
    else
        await route.continue(); });
    await panel(page).getByRole('button', { name: 'Save current changes for review' }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Cancel unused review request' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Unused change review request cancelled');
    const later = await page.request.post('/api/analytics/alerts', { headers: { origin }, data: command });
    expect(later.ok()).toBe(true);
    expect((await later.json()).status).toBe('cancelled_request');
    expect(await sets(f)).toHaveLength(0);
});
test('another review makes the full stale selection wait without partially changing it', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    const set = (await sets(f))[0], first = (await allItems(f, set.id))[0];
    await selected(page).getByRole('button', { name: 'Select this page' }).click();
    const r = await page.request.post('/api/analytics/alerts', { headers: { origin }, data: { propertyId: f.property, expectedActorId: f.id, id: randomUUID(), operation: 'review', setId: set.id, items: [{ key: first.item_key, revision: 1 }], note: 'Concurrent reviewed decision' } });
    expect(r.ok()).toBe(true);
    await selected(page).getByRole('button', { name: 'Dismiss selected' }).click();
    await expect(panel(page).getByRole('alert')).toContainText('reviewed elsewhere');
    expect((await allItems(f, set.id)).filter(i => i.state === 'reviewed')).toHaveLength(1);
    expect((await allItems(f, set.id)).filter(i => i.state === 'dismissed')).toHaveLength(0);
    await panel(page).getByRole('button', { name: 'Cancel unused review request' }).click();
    await expect(selected(page)).toContainText('Concurrent reviewed decision');
});
test('new imports get a separate review and never inherit dismissed decisions', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    await selected(page).getByRole('checkbox').first().check();
    await selected(page).getByRole('button', { name: 'Dismiss selected' }).click();
    const original = (await sets(f))[0];
    sql(`UPDATE fact_marketing_performance SET clicks=1000 WHERE property_id='${f.property}' AND date='${f.today}';`);
    await Promise.all([page.waitForResponse(r => r.url().includes('/api/analytics/reports?') && r.status() === 200), page.getByRole('button', { name: 'Refresh data', exact: true }).click()]);
    await expect(page.getByText('2,400', { exact: true }).first()).toBeVisible();
    await prepare(page);
    const catalog = await sets(f);
    expect(catalog).toHaveLength(2);
    expect(catalog[0].source_hash).not.toBe(catalog[1].source_hash);
    expect((await allItems(f, catalog[1].id)).every(i => i.state === 'open')).toBe(true);
    expect((await allItems(f, original.id)).filter(i => i.state === 'dismissed')).toHaveLength(1);
    await panel(page).getByRole('region', { name: 'Saved change reviews' }).getByRole('button').filter({ hasText: '120 changes' }).click();
    await expect(selected(page)).toContainText('Historical review');
});
test('viewer can inspect the retained review but cannot record decisions', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    const set = (await sets(f))[0], first = (await allItems(f, set.id))[0];
    sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer' WHERE id='${f.id}';COMMIT;`);
    await page.reload();
    await panel(page).getByRole('button', { name: 'Open change review' }).click();
    await expect(panel(page)).toContainText('An administrator or manager can record review decisions');
    await panel(page).getByRole('region', { name: 'Saved change reviews' }).getByRole('button').filter({ hasText: '120 changes' }).click();
    await expect(selected(page).getByRole('button', { name: 'Select this page' })).toBeDisabled();
    const denied = await page.request.post('/api/analytics/alerts', { headers: { origin }, data: { propertyId: f.property, expectedActorId: f.id, id: randomUUID(), operation: 'review', setId: set.id, items: [{ key: first.item_key, revision: 1 }], note: 'Not authorized' } });
    expect(denied.status()).toBe(403);
    expect((await allItems(f, set.id)).every(i => i.state === 'open')).toBe(true);
});
test('insufficient coverage remains explicit in a saved review', async ({ page, fixture: f }) => {
    sql(`DELETE FROM fact_marketing_performance WHERE property_id='${f.property}' AND date<>'${f.today}';`);
    await login(page, f);
    await expect(panel(page)).toContainText('Not enough comparable data');
    await prepare(page);
    await expect(selected(page)).toContainText('not enough comparable dates');
    expect((await sets(f))[0].derived.alerts).toEqual([]);
    await expect(selected(page).getByRole('button', { name: 'Mark selected reviewed' })).toBeDisabled();
});
