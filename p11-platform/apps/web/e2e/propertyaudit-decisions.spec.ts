import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-audit-decision-fixture-password';
const service = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(input: string) { return execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'pipe', 'pipe'] }); }
type Fixture = {
    id: string;
    email: string;
    org: string;
    property: string;
    db: ReturnType<typeof service>;
};
const test = base.extend<{
    fixture: Fixture;
}>({ fixture: async ({}, provide) => {
        if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname))
            throw new Error('Local synthetic fixtures only');
        const db = service(), email = 'audit-decision-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID();
        try {
            sql(`BEGIN;INSERT INTO organizations(id,name)VALUES('${org}','Audit decision browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO properties(id,org_id,name,website_url)VALUES('${property}','${org}','Audit decision fixture property','https://audit-fixture.invalid');COMMIT;`);
            await provide({ id, email, org, property, db });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM property_vertical_profile_versions WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id=NULL,role='viewer'WHERE org_id='${org}';DELETE FROM organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fpropertyaudit'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/propertyaudit/, { timeout: 30000 }); await p.getByRole('button', { name: /^Queries \(/ }).click(); await expect(p.getByRole('button', { name: 'Add audit question', exact: true })).toBeEnabled({ timeout: 30000 }); }
async function add(p: Page, text = 'How does the fixture property compare?') { await p.getByRole('button', { name: 'Add audit question', exact: true }).click(); const form = p.getByRole('form', { name: 'Audit question form' }); await form.getByRole('textbox', { name: 'Question text', exact: true }).fill(text); await form.getByRole('button', { name: 'Save question decision' }).click(); return form; }
async function queries(f: Fixture) { const r = await f.db.from('geo_queries').select('*').eq('property_id', f.property).order('created_at'); expect(r.error).toBeNull(); return r.data!; }
async function read(p: Page, f: Fixture, kind = 'context', id?: string) { const r = await p.request.get('/api/propertyaudit/decisions', { params: { propertyId: f.property, kind, ...(id ? { id } : {}) } }); expect(r.status()).toBe(200); return r.json(); }
async function decision(p: Page, f: Fixture, input: Record<string, unknown>) { return p.request.post('/api/propertyaudit/decisions', { headers: { origin }, data: { id: randomUUID(), propertyId: f.property, expectedActorId: f.id, ...input } }); }
async function queueFixture(p: Page, f: Fixture) { const context = await read(p, f); const r = await decision(p, f, { operation: 'run_request', sourceHash: context.context.hash, modelHash: context.models.hash, surfaces: ['chatgpt'], executionCount: 1, includeSiteCrawl: false, useLocalFixture: true }); expect(r.status()).toBe(200); return (await r.json()).runIds[0] as string; }
async function rpc(f: Fixture, name: string, args: Record<string, unknown>) {
    const r = await (f.db as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{
            data: {
                state: string;
                lease_token: string;
                item: {
                    id: string;
                };
                invocationId: string;
            };
            error: unknown;
        }>;
    }).rpc(name, args);
    expect(r.error).toBeNull();
    return r.data;
}
test('edit, archive, restore inactive, and inspect retained question history on desktop and mobile', async ({ page, fixture: f }, info) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await login(page, f); await expect(await add(page)).toBeHidden(); const manager = page.getByRole('region', { name: 'Audit question management' }); await manager.getByRole('button', { name: 'Edit question', exact: true }).click(); const form = page.getByRole('form', { name: 'Audit question form' }); await form.getByRole('textbox', { name: 'Question text', exact: true }).fill('Revised question with private source detail'); await form.getByRole('button', { name: 'Save question decision' }).click(); await expect(form).toBeHidden(); await manager.getByRole('checkbox', { name: 'Select Revised question with private source detail' }).check(); await manager.getByRole('button', { name: 'Archive selected questions' }).click(); await expect(manager).toContainText('0 questions'); await manager.getByLabel('Question inventory').selectOption('archived'); await manager.getByRole('checkbox', { name: 'Select Revised question with private source detail' }).check(); await manager.getByRole('button', { name: 'Restore selected as inactive' }).click(); await expect(manager).toContainText('0 questions'); expect((await queries(f))[0]).toMatchObject({ is_active: false, archived_at: null }); await page.getByRole('button', { name: 'history', exact: true }).click(); const history = page.getByRole('region', { name: 'Audit decision history' }); await expect(history).toContainText('Questions restored inactive'); await expect(history).toContainText('How does the fixture property compare? → Revised question with private source detail'); const events = await f.db.from('shared_action_events').select('action,request,result,training_eligible').eq('property_id', f.property).like('action', 'audit.%'); expect(events.data).toHaveLength(4); expect(events.data!.every(v => !v.training_eligible)).toBe(true); expect(JSON.stringify(events.data)).not.toContain('private source detail'); expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath('audit-history-desktop.png') }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath('audit-history-mobile.png') }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); });
test('lost save acknowledgement recovers after reload without duplicating questions', async ({ page, fixture: f }) => {
    await login(page, f);
    let lost = false;
    await page.route('**/api/propertyaudit/decisions', async (route) => {
        if (!lost && route.request().method() === 'POST' && route.request().postDataJSON()?.operation === 'query_create') {
            lost = true;
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    const form = await add(page);
    await expect(page.getByRole('alert').filter({ hasText: /fetch|confirm|failed/i }).first()).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Question text', exact: true })).toHaveValue('How does the fixture property compare?');
    const storage = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('p11.audit-decision.v1:')).map(([, v]) => JSON.parse(v)));
    expect(storage).toHaveLength(1);
    expect(Object.keys(storage[0])).toEqual(['id']);
    await page.reload();
    await page.getByRole('button', { name: 'Check audit request' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Audit decision saved' })).toBeVisible();
    expect(await queries(f)).toHaveLength(1);
});
test('unused request cancellation fences a delayed question create', async ({ page, fixture: f }) => {
    await login(page, f);
    let original: unknown;
    await page.route('**/api/propertyaudit/decisions', async (route) => {
        if (route.request().method() === 'POST' && route.request().postDataJSON()?.operation === 'query_create') {
            original = route.request().postDataJSON();
            await route.abort();
        }
        else
            await route.continue();
    });
    await add(page);
    await page.getByRole('button', { name: 'Cancel unused audit request' }).click();
    await expect(page.getByRole('status')).toContainText('Unused audit request cancelled');
    await page.unroute('**/api/propertyaudit/decisions');
    const r = await page.request.post('/api/propertyaudit/decisions', { headers: { origin }, data: original });
    expect((await r.json()).status).toBe('cancelled_request');
    expect(await queries(f)).toHaveLength(0);
});
test('stale query edit keeps its draft and cannot overwrite a concurrent choice', async ({ page, fixture: f }) => { await login(page, f); await expect(await add(page)).toBeHidden(); await page.getByRole('button', { name: 'Edit question', exact: true }).click(); const form = page.getByRole('form', { name: 'Audit question form' }); await form.getByRole('textbox', { name: 'Question text', exact: true }).fill('My retained audit draft'); const query = (await queries(f))[0]; await f.db.from('geo_queries').update({ text: 'Concurrent saved wording' }).eq('id', query.id); await form.getByRole('button', { name: 'Save question decision' }).click(); await expect(page.getByRole('alert').filter({ hasText: 'The query changed' })).toBeVisible(); await expect(form.getByRole('textbox', { name: 'Question text', exact: true })).toHaveValue('My retained audit draft'); expect((await queries(f))[0].text).toBe('Concurrent saved wording'); });
test('current role withdrawal blocks decisions while history stays readable', async ({ page, fixture: f }) => { await login(page, f); await expect(await add(page)).toBeHidden(); sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`); const q = (await queries(f))[0]; expect((await decision(page, f, { operation: 'query_archive', selection: [{ id: q.id, revision: q.decision_revision }], reason: '' })).status()).toBe(403); await page.reload(); await page.getByRole('button', { name: /^Queries \(/ }).click(); await expect(page.getByRole('button', { name: 'Add audit question', exact: true })).toBeDisabled(); await page.getByRole('button', { name: 'history', exact: true }).click(); await expect(page.getByRole('region', { name: 'Audit decision history' })).toContainText('Questions created'); });
test('reviewed property proposal remains a draft until explicitly saved', async ({ page, fixture: f }) => { await login(page, f); await page.getByRole('button', { name: 'Prepare property questions' }).click(); const proposal = page.getByRole('region', { name: 'Proposed audit questions' }); await expect(proposal).toBeVisible(); expect(await queries(f)).toHaveLength(0); await proposal.getByRole('textbox', { name: 'Proposed question 1', exact: true }).fill('Reviewed generated question'); await proposal.getByRole('button', { name: 'Save reviewed question set' }).click(); await expect(proposal).toBeHidden(); expect((await queries(f)).some(q => q.text === 'Reviewed generated question')).toBe(true); await page.getByRole('button', { name: 'Run Audit', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Review audit request' }); await expect(dialog).toContainText('do not establish statistical confidence'); await expect(dialog.getByLabel('Include website crawl and grounded recommendations', { exact: false })).toBeChecked(); await dialog.getByRole('button', { name: 'Close audit request' }).click(); expect((await f.db.from('geo_runs').select('id').eq('property_id', f.property)).data).toHaveLength(0); });
test('a stopped run retains a late response and allows an explicit linked retry', async ({ page, fixture: f }, info) => { await login(page, f); await expect(await add(page)).toBeHidden(); const runId = await queueFixture(page, f), job = await rpc(f, 'claim_geo_execution', { p_run_id: runId }), next = await rpc(f, 'advance_geo_execution', { p_run_id: runId, p_token: job.lease_token }), invocation = await rpc(f, 'start_geo_provider_invocation', { p_run_id: runId, p_token: job.lease_token, p_item_id: next.item.id }); expect(invocation.state).toBe('claimed'); await page.getByRole('button', { name: 'history', exact: true }).click(); const inventory = page.getByRole('region', { name: 'Complete audit run history' }); await inventory.getByRole('button').filter({ hasText: 'chatgpt' }).click(); const controls = page.getByRole('region', { name: 'Saved audit controls' }); await expect(controls).toContainText('Synthetic local measurement'); await controls.getByLabel('Decision reason').fill('Stop the synthetic measurement'); await controls.getByRole('button', { name: 'Stop answer measurements' }).click(); await expect(controls).toContainText('Stopped by an operator'); expect((await rpc(f, 'finish_geo_provider_invocation', { p_id: invocation.invocationId, p_token: job.lease_token, p_result: { answer: { answer_summary: 'Retained late synthetic response' } } })).state).toBe('retained'); expect((await rpc(f, 'apply_geo_provider_invocation', { p_id: invocation.invocationId, p_run_id: runId, p_token: job.lease_token })).state).toBe('lease_lost'); await controls.getByRole('button', { name: 'Refresh saved audit' }).click(); await controls.getByText('Recorded provider responses', { exact: true }).click(); await controls.getByRole('button', { name: 'Inspect retained response' }).click(); await expect(controls).toContainText('Retained late synthetic response'); await controls.getByRole('button', { name: 'Request linked audit retry' }).click(); await expect(controls.getByRole('button', { name: 'Open linked audit retry' })).toBeVisible(); expect((await f.db.from('geo_runs').select('id').eq('retry_of', runId)).data).toHaveLength(1); expect((await f.db.from('geo_answers').select('id').eq('run_id', runId)).data).toHaveLength(0); await page.screenshot({ path: info.outputPath('audit-retained-response.png') }); });
test('complete inventory pages remain reachable and retired destructive routes are held', async ({ page, fixture: f }) => { await login(page, f); sql(`INSERT INTO geo_queries(property_id,text,type,is_active)SELECT '${f.property}','Retained question '||n,'faq',false FROM generate_series(1,53)n;`); await page.getByRole('button', { name: 'Refresh questions' }).click(); const manager = page.getByRole('region', { name: 'Audit question management' }); await expect(manager).toContainText('1–25 of 53 questions'); await manager.getByRole('button', { name: 'Next questions', exact: true }).click(); await expect(manager).toContainText('26–50 of 53 questions'); await manager.getByRole('button', { name: 'Next questions', exact: true }).click(); await expect(manager).toContainText('51–53 of 53 questions'); expect((await page.request.post('/api/propertyaudit/runs/purge', { headers: { origin }, data: { propertyId: f.property } })).status()).toBe(410); expect((await page.request.delete('/api/propertyaudit/queries/' + (await queries(f))[0].id)).status()).toBe(410); expect(await queries(f)).toHaveLength(53); });
