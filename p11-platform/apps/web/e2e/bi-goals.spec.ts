// Fixture reporting dates follow the browser calendar, including the UTC/local midnight boundary.
import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-bi-goal-fixture-password';
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
        const db = service(), email = 'bi-goal-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID(), today = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; });
        try {
            sql(`BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','BI goals browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin' WHERE id='${id}';INSERT INTO public.properties(id,org_id,name)VALUES('${property}','${org}','BI report fixture property');INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)SELECT '${property}','${today}','google_ads','1111111111','USD','campaign-'||n,CASE WHEN n=31 THEN '=SUM(2,3) "quoted" final campaign' ELSE 'Report campaign '||n END,100,10,10.01,0.125 FROM generate_series(0,31)n;INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)VALUES('${property}','${today}','google_ads','2222222222','USD','campaign-0','Report campaign 0 second account',0,0,0,0),('${property}','${today}'::date-30,'google_ads','1111111111','USD','prior','Prior zero baseline',0,0,0,0);COMMIT;`);
            await provide({ id, email, org, property, db, today });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM public.fact_marketing_performance WHERE property_id='${property}';DELETE FROM public.properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer' WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
const panel = (p: Page) => p.getByRole('region', { name: 'Marketing goals', exact: true });
const saved = (p: Page) => panel(p).getByRole('region', { name: 'Saved marketing goals' });
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fbi'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/bi/, { timeout: 30000 }); await expect(panel(p).getByRole('button', { name: 'Add goal' })).toBeEnabled({ timeout: 30000 }); }
async function prepare(p: Page, period = 'quarterly') { await panel(p).getByRole('button', { name: 'Add goal' }).click(); await panel(p).getByRole('combobox', { name: 'Goal period', exact: true }).selectOption(period); await panel(p).getByLabel('Target', { exact: true }).fill('125.5'); }
async function create(p: Page, period = 'quarterly') { await prepare(p, period); await panel(p).getByRole('button', { name: 'Save goal', exact: true }).click(); await expect(panel(p).getByRole('status')).toContainText('active'); }
const read = (f: Fixture, kind = 'goals') => '/api/analytics/goals?' + new URLSearchParams({ propertyId: f.property, kind });
async function row(f: Fixture) { const r = await f.db.from('metric_goals').select('*').eq('property_id', f.property).single(); expect(r.error).toBeNull(); return r.data!; }
test('quarterly and yearly goals support edit, archive, restore and visible history', async ({ page, fixture: f }, info) => {
    await login(page, f);
    await create(page);
    await expect(saved(page)).toContainText('Quarterly Conversions: at least 125.5');
    await expect(saved(page)).toContainText('Comparison unavailable');
    await saved(page).getByRole('button', { name: 'Edit goal' }).click();
    await panel(page).getByLabel('Target', { exact: true }).fill('150.75');
    await panel(page).getByRole('button', { name: 'Save goal', exact: true }).click();
    await expect(saved(page)).toContainText('Revision 2');
    await saved(page).getByRole('button', { name: 'Archive goal' }).click();
    await expect(saved(page)).toContainText('Archived · Revision 3');
    await saved(page).getByRole('button', { name: 'Restore goal' }).click();
    await expect(saved(page)).toContainText('Active · Revision 4');
    await create(page, 'yearly');
    await expect(saved(page)).toContainText('Yearly Conversions');
    await panel(page).getByRole('button', { name: 'Goal history' }).click();
    await expect(panel(page).getByRole('region', { name: 'Goal decision history' })).toContainText('Before: Quarterly Conversions: at least 125.5');
    const actions = await f.db.from('shared_action_events').select('action,training_eligible').eq('property_id', f.property).like('action', 'bi.goal.%');
    expect(actions.data).toHaveLength(5);
    expect(actions.data?.every(a => !a.training_eligible)).toBe(true);
    await panel(page).getByRole('heading', { name: 'Marketing goals', exact: true }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('goals-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel(page).getByRole('heading', { name: 'Marketing goals', exact: true }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('goals-mobile.png') });
    await panel(page).getByRole('heading', { name: 'Goal decision history' }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('goals-mobile-history.png') });
});
test('lost reply survives reload and recovers without duplicating or storing target content', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    let lost = false;
    await page.route('**/api/analytics/goals', async (route) => { if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'save' && !lost) {
        lost = true;
        await route.fetch();
        await route.abort();
    }
    else
        await route.continue(); });
    await panel(page).getByRole('button', { name: 'Save goal', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    const stored = await page.evaluate(({ id, property }) => JSON.parse(sessionStorage.getItem(`p11.bi-goal.v1:${id}:${property}`)!), { id: f.id, property: f.property });
    expect(Object.keys(stored)).toEqual(['id']);
    await page.reload();
    await panel(page).getByRole('button', { name: 'Check goal request' }).click();
    await expect(panel(page).getByRole('status')).toContainText('active');
    expect((await f.db.from('bi_control_commands').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(1);
});
test('unused request can be cancelled and fences a late original save', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    let command: Record<string, unknown> | undefined;
    await page.route('**/api/analytics/goals', async (route) => { if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'save') {
        command = route.request().postDataJSON();
        await route.abort();
    }
    else
        await route.continue(); });
    await panel(page).getByRole('button', { name: 'Save goal', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Cancel unused goal request' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Unused goal request cancelled');
    const late = await page.request.post('/api/analytics/goals', { data: command, headers: { origin } });
    expect(late.ok()).toBe(true);
    expect((await late.json()).status).toBe('cancelled_request');
    expect((await f.db.from('metric_goals').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(0);
});
test('concurrent edit cannot overwrite newer target and failed form stays visible', async ({ page, fixture: f }) => {
    await login(page, f);
    await create(page);
    const g = await row(f);
    await saved(page).getByRole('button', { name: 'Edit goal' }).click();
    await panel(page).getByLabel('Target', { exact: true }).fill('900');
    const external = await page.request.post('/api/analytics/goals', { headers: { origin }, data: { id: randomUUID(), propertyId: f.property, expectedActorId: f.id, operation: 'save', goalId: g.id, expectedRevision: 1, metric: 'conversions', period: 'quarterly', target: 300, direction: 'at_least', threshold: 80 } });
    expect(external.ok()).toBe(true);
    await panel(page).getByRole('button', { name: 'Save goal', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('This goal changed');
    await expect(panel(page).getByRole('form', { name: 'Edit marketing goal' })).toBeVisible();
    expect((await row(f)).target_value).toBe(300);
    await panel(page).getByRole('button', { name: 'Cancel unused goal request' }).click();
    await expect(saved(page)).toContainText('at least 300');
});
test('viewer can read goals but cannot mutate through a stale tab', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer' WHERE id='${f.id}';COMMIT;`);
    await panel(page).getByRole('button', { name: 'Save goal', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('Only a current property');
    expect((await f.db.from('metric_goals').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(0);
    const response = await page.request.get(read(f));
    expect(response.ok()).toBe(true);
    expect((await response.json()).canManage).toBe(false);
});
test('goal management remains available when report source fails', async ({ page, fixture: f }) => {
    await page.route('**/api/analytics/reports?**', route => route.fulfill({ status: 503, json: { error: 'Synthetic report source unavailable' } }));
    await login(page, f);
    await create(page);
    await expect(saved(page)).toContainText('Comparison unavailable');
});
