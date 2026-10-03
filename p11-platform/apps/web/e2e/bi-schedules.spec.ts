// Fixture reporting dates follow the browser calendar, including the UTC/local midnight boundary.
import { processBiSchedule } from '../utils/analytics/schedule-worker';
import { writeFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-bi-schedule-fixture-password';
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
        const db = service(), email = 'bi-schedule-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID(), today = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; });
        try {
            sql(`BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','BI schedule browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin' WHERE id='${id}';INSERT INTO public.properties(id,org_id,name)VALUES('${property}','${org}','BI report fixture property');INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)SELECT '${property}','${today}','google_ads','1111111111','USD','campaign-'||n,CASE WHEN n=31 THEN '=SUM(2,3) "quoted" final campaign' ELSE 'Report campaign '||n END,100,10,10.01,0.125 FROM generate_series(0,31)n;INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)VALUES('${property}','${today}','google_ads','2222222222','USD','campaign-0','Report campaign 0 second account',0,0,0,0),('${property}','${today}'::date-30,'google_ads','1111111111','USD','prior','Prior zero baseline',0,0,0,0);COMMIT;`);
            await provide({ id, email, org, property, db, today });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM public.fact_marketing_performance WHERE property_id='${property}';DELETE FROM public.properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id=NULL,role='viewer' WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
const modal = (p: Page) => p.getByRole('dialog', { name: 'Scheduled reports' }), list = (p: Page) => modal(p).getByRole('region', { name: 'Report schedules', exact: true }), selected = (p: Page) => modal(p).getByRole('region', { name: 'Selected report schedule' });
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fbi'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/bi/, { timeout: 30000 }); await p.getByRole('button', { name: 'Schedule', exact: true }).click(); await expect(modal(p).getByRole('button', { name: 'Refresh schedules' })).toBeEnabled({ timeout: 30000 }); }
async function prepare(p: Page, name = 'Weekly client review') { await modal(p).getByLabel('Schedule name').fill(name); await modal(p).getByLabel('Recipient emails').fill('one@fixture.invalid\ntwo@fixture.invalid'); await modal(p).getByLabel('Report period').selectOption('last_7_days'); await modal(p).getByRole('button', { name: 'Preview report', exact: true }).click(); await expect(modal(p).getByRole('button', { name: 'Save paused schedule' })).toBeEnabled(); }
async function create(p: Page, name = 'Weekly client review') { await prepare(p, name); await modal(p).getByRole('button', { name: 'Save paused schedule' }).click(); await expect(modal(p).getByRole('status')).toContainText('Paused'); await expect(selected(p)).toBeVisible(); }
const read = (f: Fixture, kind = 'list', id?: string) => '/api/reports/scheduled?' + new URLSearchParams({ propertyId: f.property, kind, ...(id ? { id } : {}) });
async function row(f: Fixture) { const r = await f.db.from('bi_schedules').select('*').eq('property_id', f.property).single(); expect(r.error).toBeNull(); return r.data!; }
async function rpc(f: Fixture, name: string, args: Record<string, unknown>) { const r = await f.db.rpc(name, args); expect(r.error, JSON.stringify(r.error)).toBeNull(); return r.data; }
async function claim(f: Fixture) {
    const s = await row(f);
    sql(`BEGIN;SELECT set_config('p11.bi_schedule_scope','${f.property}',true);UPDATE public.bi_schedules SET next_run_at=clock_timestamp()-interval'1 minute' WHERE id='${s.id}';COMMIT;`);
    const id = randomUUID();
    expect((await rpc(f, 'claim_bi_schedule', { p_id: id, p_schedule_id: s.id })).state).toBe('claimed');
    const ready = await rpc(f, 'prepare_bi_schedule_run', { p_id: id, p_payload: { from: 'reports@fixture.invalid', subject: 'Fixture only', html: '<p>Synthetic report; no email sent.</p>' } });
    expect(ready.state).toBe('prepared');
    return { id, deliveries: ready.deliveries as Array<{
            id: string;
            recipient: string;
        }> };
}
test('prepare, schedule, edit, pause and cancel retain decisions without email', async ({ page, fixture: f }, info) => {
    await login(page, f);
    await expect(modal(page)).toContainText('Email delivery is paused');
    await create(page);
    expect((await row(f)).state).toBe('paused');
    await selected(page).getByRole('button', { name: 'Schedule future reports' }).click();
    await expect(selected(page)).toContainText('Scheduled · Revision 2');
    const s = await row(f);
    expect(new Date(s.next_run_at).getTime()).toBeGreaterThan(Date.now());
    await selected(page).getByRole('button', { name: 'Pause schedule' }).click();
    await expect(selected(page)).toContainText('Paused · Revision 3');
    await selected(page).getByRole('button', { name: 'Edit schedule' }).click();
    await modal(page).getByLabel('Schedule name').fill('Monthly property report');
    await modal(page).getByRole('combobox', { name: 'Frequency', exact: true }).selectOption('monthly');
    await modal(page).getByLabel('Day of month').selectOption('28');
    await modal(page).getByRole('button', { name: 'Preview report', exact: true }).click();
    await modal(page).getByRole('button', { name: 'Save schedule changes' }).click();
    await expect(selected(page)).toContainText('Monthly property report');
    expect((await row(f)).config.monthday).toBe(28);
    await selected(page).getByRole('button', { name: 'Cancel schedule', exact: true }).click();
    await expect(selected(page)).toContainText('Cancelled');
    await selected(page).getByRole('button', { name: 'Decision history' }).click();
    await expect(selected(page)).toContainText('schedule cancelled');
    const events = await f.db.from('shared_action_events').select('action,training_eligible').eq('property_id', f.property).like('action', 'bi.schedule.%');
    expect(events.data).toHaveLength(5);
    expect(events.data?.every(e => !e.training_eligible)).toBe(true);
    expect((await f.db.from('bi_schedule_runs').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(0);
    await page.screenshot({ path: info.outputPath('schedules-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => { const d = document.querySelector('dialog')!; return d.scrollWidth <= d.clientWidth && document.documentElement.scrollWidth <= innerWidth; })).toBe(true);
    await page.screenshot({ path: info.outputPath('schedules-mobile.png'), fullPage: true });
});
test('lost create response recovers after reopening without storing recipients or duplicating', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    let lost = false;
    await page.route('**/api/reports/scheduled', async (route) => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'create' && !lost) {
            lost = true;
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    await modal(page).getByRole('button', { name: 'Save paused schedule' }).click();
    await expect(modal(page)).toContainText('A schedule request needs confirmation');
    await expect(modal(page).getByRole('alert')).toBeVisible();
    const raw = await page.evaluate(({ id, property }) => JSON.parse(sessionStorage.getItem(`p11.bi-schedule.v1:${id}:${property}`)!), { id: f.id, property: f.property });
    expect(Object.keys(raw)).toEqual(['id']);
    await modal(page).getByRole('button', { name: 'Close scheduled reports' }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await modal(page).getByRole('button', { name: 'Check request result' }).click();
    await expect(modal(page).getByRole('status')).toContainText('Paused');
    expect((await f.db.from('bi_schedules').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(1);
});
test('cancel unused request fences a delayed create', async ({ page, fixture: f }) => {
    await login(page, f);
    await prepare(page);
    let input: unknown;
    await page.route('**/api/reports/scheduled', async (route) => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'create' && !input) {
            input = route.request().postDataJSON();
            await route.abort();
        }
        else
            await route.continue();
    });
    await modal(page).getByRole('button', { name: 'Save paused schedule' }).click();
    await modal(page).getByRole('button', { name: 'Cancel unused request' }).click();
    await expect(modal(page).getByRole('status')).toContainText('Unused request cancelled');
    const late = await page.request.post('/api/reports/scheduled', { headers: { origin }, data: input });
    expect((await late.json()).status).toBe('cancelled_request');
    expect((await f.db.from('bi_schedules').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(0);
});
test('stale revision and changed account are held and recoverable', async ({ page, fixture: f }) => { await login(page, f); await create(page); const s = await row(f); await rpc(f, 'decide_bi_schedule', { p_id: randomUUID(), p_actor_id: f.id, p_property_id: f.property, p_input: { operation: 'resume', scheduleId: s.id, expectedRevision: s.revision } }); await selected(page).getByRole('button', { name: 'Cancel schedule', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('schedule changed'); expect((await row(f)).state).toBe('active'); await modal(page).getByRole('button', { name: 'Cancel unused request' }).click(); const bad = await page.request.post('/api/reports/scheduled', { headers: { origin }, data: { operation: 'cancel_request', id: randomUUID(), propertyId: f.property, expectedActorId: randomUUID() } }); expect(bad.status()).toBe(409); expect((await page.request.get(read(f).replace(f.property, randomUUID()))).status()).toBe(403); });
test('permission removal blocks mutation and read-only members cannot schedule', async ({ page, fixture: f }) => { await login(page, f); await create(page); sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE public.profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`); await selected(page).getByRole('button', { name: 'Schedule future reports' }).click(); await expect(modal(page).getByRole('alert')).toContainText('administrator or manager'); expect((await row(f)).state).toBe('paused'); sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE public.profiles SET org_id=NULL WHERE id='${f.id}';COMMIT;`); expect((await page.request.get(read(f))).status()).toBe(403); });
test('browser storage failure prevents an untracked create', async ({ page, fixture: f }) => { await login(page, f); await prepare(page); await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('fixture storage failure'); }; }); await modal(page).getByRole('button', { name: 'Save paused schedule' }).click(); await expect(modal(page).getByRole('alert')).toContainText('allow browser storage'); expect((await f.db.from('bi_schedules').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(0); });
test('retained recipient outcomes distinguish acceptance from receipt and close an interrupted run', async ({ page, fixture: f }) => { await login(page, f); await create(page); await selected(page).getByRole('button', { name: 'Schedule future reports' }).click(); await expect(selected(page)).toContainText('Scheduled · Revision 2'); const run = await claim(f), token = randomUUID(); await rpc(f, 'start_bi_schedule_delivery', { p_id: run.deliveries[0].id, p_claim_token: token }); await rpc(f, 'finish_bi_schedule_delivery', { p_id: run.deliveries[0].id, p_claim_token: token, p_provider_id: 'synthetic-provider-acceptance' }); await rpc(f, 'finish_bi_schedule_run', { p_id: run.id, p_issue: 'interrupted' }); await modal(page).getByRole('button', { name: 'Refresh schedules' }).click(); await list(page).getByRole('button', { name: /Weekly client review/ }).click(); await selected(page).getByRole('button', { name: /Needs review/ }).click(); await expect(selected(page).getByLabel('Recipient outcomes')).toContainText('one@fixture.invalid: Provider accepted'); await expect(selected(page).getByLabel('Recipient outcomes')).toContainText('two@fixture.invalid: Not started'); await expect(selected(page)).toContainText('has not been independently confirmed'); await selected(page).getByRole('button', { name: 'End unresolved run' }).click(); await expect(selected(page)).toContainText('Paused'); await selected(page).getByRole('button', { name: 'Schedule future reports' }).click(); await expect(selected(page)).toContainText('Scheduled'); expect((await f.db.from('bi_schedule_runs').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(1); });
test('concurrent native claims produce only one retained occurrence', async ({ page, fixture: f }) => { await login(page, f); await create(page); await selected(page).getByRole('button', { name: 'Schedule future reports' }).click(); await expect(selected(page)).toContainText('Scheduled · Revision 2'); const s = await row(f); sql(`BEGIN;SELECT set_config('p11.bi_schedule_scope','${f.property}',true);UPDATE public.bi_schedules SET next_run_at=clock_timestamp()-interval'1 minute'WHERE id='${s.id}';COMMIT;`); const claims = await Promise.all(Array.from({ length: 4 }, () => rpc(f, 'claim_bi_schedule', { p_id: randomUUID(), p_schedule_id: s.id }))); expect(claims.filter(v => v.state === 'claimed')).toHaveLength(1); expect((await f.db.from('bi_schedule_runs').select('id', { count: 'exact', head: true }).eq('property_id', f.property)).count).toBe(1); });
test('schedule and legacy histories paginate and old delete cannot erase records', async ({ page, fixture: f }) => {
    await login(page, f);
    const config = { name: 'Paged schedule', frequency: 'daily', weekday: null, monthday: null, hour: 9, window: 'last_7_days', comparison: true, campaigns: false, recipients: ['one@fixture.invalid'] };
    for (let i = 0; i < 22; i++)
        await rpc(f, 'decide_bi_schedule', { p_id: randomUUID(), p_actor_id: f.id, p_property_id: f.property, p_input: { operation: 'create', config: { ...config, name: 'Paged ' + i } } });
    await modal(page).getByRole('button', { name: 'Refresh schedules' }).click();
    await expect(list(page)).toContainText('1–20 of 22');
    await list(page).getByRole('button', { name: 'Next page' }).click();
    await expect(list(page)).toContainText('21–22 of 22');
    const legacyId = randomUUID();
    expect((await f.db.from('scheduled_reports').insert({ id: legacyId, org_id: f.org, property_id: f.property, name: 'Earlier report fixture', schedule_type: 'daily', recipients: ['one@fixture.invalid'], created_by: f.id })).error).toBeNull();
    expect((await f.db.from('report_send_history').insert(Array.from({ length: 22 }, () => ({ scheduled_report_id: legacyId, status: 'sent', recipients_count: 1 })))).error).toBeNull();
    await modal(page).getByRole('button', { name: 'Review earlier schedules' }).click();
    await modal(page).getByRole('button', { name: 'Earlier report fixture · Earlier history' }).click();
    const earlier = modal(page).getByRole('region', { name: 'Earlier report schedules' });
    await expect(earlier).toContainText('1–20 of 22');
    await earlier.getByRole('button', { name: 'Next page' }).last().click();
    await expect(earlier).toContainText('21–22 of 22');
    expect((await page.request.delete('/api/reports/scheduled?id=' + legacyId, { headers: { origin } })).status()).toBe(410);
    expect((await f.db.from('report_send_history').select('id', { count: 'exact', head: true }).eq('scheduled_report_id', legacyId)).count).toBe(22);
});
test('actual worker stores complete report and separate synthetic provider acceptances exactly once', async ({ fixture: f, page }, info) => {
    const config = { name: 'Synthetic worker report', frequency: 'daily', weekday: null, monthday: null, hour: 9, window: 'last_7_days', comparison: true, campaigns: true, recipients: ['one@fixture.invalid', 'two@fixture.invalid'] };
    const scheduleId = randomUUID();
    await rpc(f, 'decide_bi_schedule', { p_id: scheduleId, p_actor_id: f.id, p_property_id: f.property, p_input: { operation: 'create', config } });
    await rpc(f, 'decide_bi_schedule', { p_id: randomUUID(), p_actor_id: f.id, p_property_id: f.property, p_input: { operation: 'resume', scheduleId, expectedRevision: 1 } });
    sql(`BEGIN;SELECT set_config('p11.bi_schedule_scope','${f.property}',true);UPDATE public.bi_schedules SET next_run_at=clock_timestamp()-interval'1 minute'WHERE id='${scheduleId}';UPDATE public.fact_marketing_performance SET date='${f.today}'::date-1 WHERE property_id='${f.property}'AND date='${f.today}';COMMIT;`);
    const sends: Array<{
        to: string;
        html: string;
        key: string;
    }> = [];
    const result = await processBiSchedule(scheduleId, 'reports@fixture.invalid', async (payload, key) => { sends.push({ to: payload.to, html: payload.html, key }); return 'synthetic-provider-' + sends.length; }, f.db, () => true);
    expect(result).toMatchObject({ status: 'accepted', accepted: 2 });
    expect(sends).toHaveLength(2);
    writeFileSync(info.outputPath('scheduled-report.html'), sends[0].html);
    await page.setContent(sends[0].html);
    await page.screenshot({ path: info.outputPath('scheduled-email-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('scheduled-email-mobile.png') });
    await page.getByRole('heading', { name: 'Campaigns', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('scheduled-email-mobile-campaigns.png') });
    expect(sends[0].html).toBe(sends[1].html);
    expect(sends[0].html).toContain('$320.32');
    expect(sends[0].html).toContain('final campaign');
    expect(sends[0].html).toContain('0.125');
    expect(sends[0].key).not.toBe(sends[1].key);
    const r = await f.db.from('bi_schedule_runs').select('source_hash,payload,payload_hash,state').eq('property_id', f.property).single();
    expect(r.error).toBeNull();
    expect(r.data!.state).toBe('accepted');
    expect(r.data!.payload.html).toBe(sends[0].html);
    expect(r.data!.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.data!.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    const second = await processBiSchedule(scheduleId, 'reports@fixture.invalid', async () => { throw new Error('must not resend'); }, f.db, () => true);
    expect(second.status).toBe('not_due');
    expect(sends).toHaveLength(2);
    const e = await f.db.from('shared_action_events').select('actor_id,service_principal,training_eligible,result').eq('property_id', f.property).eq('action', 'bi.delivery.reported');
    expect(e.data).toHaveLength(2);
    expect(e.data?.every(v => v.actor_id === null && v.service_principal === 'bi.scheduler' && !v.training_eligible && v.result.delivered === false)).toBe(true);
});
