import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9430', origin = new URL(baseURL).origin, url = process.env.NEXT_PUBLIC_SUPABASE_URL!, password = 'local-lead-record-fixture-password';
const service = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(input: string) { return execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'pipe', 'pipe'] }); }
type Fixture = {
    id: string;
    email: string;
    org: string;
    property: string;
    workflow: string;
    db: ReturnType<typeof service>;
};
const test = base.extend<{
    fixture: Fixture;
}>({ fixture: async ({}, provide) => {
        if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname))
            throw new Error('Local disposable fixtures only');
        const db = service(), email = 'lead-record-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID(), workflow = randomUUID();
        try {
            sql(`BEGIN;INSERT INTO organizations(id,name)VALUES('${org}','Lead record browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO properties(id,org_id,name)VALUES('${property}','${org}','Lead record fixture property');INSERT INTO workflow_definitions(id,property_id,name,is_active,trigger_on,steps)VALUES('${workflow}','${property}','Reviewed welcome email',true,'lead_created','[{"action":"email","delay_hours":240,"template_slug":"welcome"}]');COMMIT;`);
            await provide({ id, email, org, property, workflow, db });
        }
        finally {
            sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE properties SET current_vertical_profile_version_id=NULL WHERE id='${property}';DELETE FROM property_vertical_profile_versions WHERE property_id='${property}';DELETE FROM lead_record_commands WHERE property_id='${property}';SET LOCAL session_replication_role=origin;DELETE FROM leads WHERE property_id='${property}';DELETE FROM properties WHERE id='${property}';SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id=NULL,role='viewer'WHERE org_id='${org}';DELETE FROM organizations WHERE id='${org}';COMMIT;`);
            expect((await db.auth.admin.deleteUser(id)).error).toBeNull();
        }
    } });
test.setTimeout(120000);
async function login(p: Page, f: Fixture) { await p.goto('/auth/login?redirect=%2Fdashboard%2Fleads'); await p.getByLabel('Email address').fill(f.email); await p.getByLabel('Password', { exact: true }).fill(password); await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p).toHaveURL(/dashboard\/leads/, { timeout: 30000 }); await expect(p.getByRole('button', { name: 'Add Lead', exact: true }).first()).toBeEnabled({ timeout: 30000 }); }
async function form(p: Page, first = 'Taylor', email = 'taylor@example.test') { await p.getByRole('button', { name: 'Add Lead', exact: true }).first().click(); const d = p.getByRole('dialog'); await d.getByLabel('First Name', { exact: true }).fill(first); await d.getByLabel('Last Name', { exact: true }).fill('Example'); await d.getByLabel('Email', { exact: true }).fill(email); await d.getByLabel('Bedroom preference').fill('studio or one bedroom'); await d.getByLabel('Lead preferences and notes').fill('Private fixture preferences'); return d; }
async function create(p: Page) { const d = await form(p); await d.getByRole('button', { name: 'Create Lead', exact: true }).click(); await expect(d).toBeHidden(); await expect(p.getByText('Taylor Example', { exact: true })).toBeVisible(); }
async function rows(f: Fixture) { const r = await f.db.from('leads').select('*').eq('property_id', f.property).order('created_at'); expect(r.error).toBeNull(); return r.data!; }
async function decision(p: Page, f: Fixture, input: Record<string, unknown>) { return p.request.post('/api/leads', { headers: { origin }, data: { id: randomUUID(), propertyId: f.property, expectedActorId: f.id, ...input } }); }
test('create, edit full contact details once, start and stop follow-up and inspect private history', async ({ page, fixture: f }, info) => { const browserErrors: string[] = []; page.on('console', m => { if (m.type() === 'error')
    browserErrors.push(m.text()); }); page.on('pageerror', e => browserErrors.push(e.message)); await login(page, f); await create(page); expect((await f.db.from('lead_workflows').select('id').eq('lead_id', (await rows(f))[0].id)).data).toHaveLength(0); await page.getByText('Taylor Example', { exact: true }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click(); const d = page.getByRole('dialog'); await d.getByLabel('First Name', { exact: true }).fill('Avery'); await d.getByLabel('Bedroom preference').fill('two bedrooms'); await d.getByRole('button', { name: 'Save Changes', exact: true }).click(); await expect(d).toBeHidden(); expect((await rows(f))[0]).toMatchObject({ first_name: 'Avery', bedrooms: 'two bedrooms', record_revision: 2 }); expect((await f.db.from('lead_record_commands').select('id').eq('property_id', f.property)).data).toHaveLength(2); await page.getByRole('button', { name: 'Automation', exact: true }).click(); const follow = page.getByRole('region', { name: 'Lead follow-up choices' }); await follow.getByRole('checkbox', { name: 'Reviewed welcome email' }).check(); await follow.getByRole('button', { name: 'Start selected follow-up' }).click(); await expect(page.getByRole('status').filter({ hasText: 'reviewed follow-up' })).toBeVisible(); await page.getByRole('button', { name: 'Details', exact: true }).click(); await page.getByRole('button', { name: 'Leased', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'workflow(s) stopped' })).toBeVisible(); const lead = (await rows(f))[0]; expect(lead.status).toBe('leased'); expect((await f.db.from('lead_workflows').select('status').eq('lead_id', lead.id)).data).toEqual([{ status: 'stopped' }]); await page.getByRole('button', { name: 'Activity', exact: true }).click(); const history = page.getByRole('region', { name: 'Lead record history' }); await expect(history).toContainText('Taylor → Avery'); await expect(history).toContainText('studio or one bedroom → two bedrooms'); const shared = await f.db.from('shared_action_events').select('action,request,result,training_eligible').eq('property_id', f.property).like('action', 'lead.record.%'); expect(shared.data).toHaveLength(4); expect(shared.data!.every(e => !e.training_eligible)).toBe(true); expect(JSON.stringify(shared.data)).not.toContain('Private fixture'); await expect(page.getByRole('region', { name: 'Lead activity and notes' })).toContainText('0 recorded activities'); expect(browserErrors).toEqual([]); await page.screenshot({ path: info.outputPath('lead-history-desktop.png') }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath('lead-history-mobile.png') }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); });
test('matching contacts require a reason and preserve both records', async ({ page, fixture: f }) => { await login(page, f); await create(page); const d = await form(page, 'Jordan'); await d.getByRole('button', { name: 'Create Lead', exact: true }).click(); await expect(d.getByRole('region', { name: 'Matching contacts' })).toContainText('1 existing lead'); expect(await rows(f)).toHaveLength(1); await d.getByLabel('Reason for a separate record').fill('Different household member sharing contact details'); await d.getByRole('button', { name: 'Create a separate lead' }).click(); await expect(d).toBeHidden(); expect((await rows(f)).map(l => l.first_name)).toEqual(['Taylor', 'Jordan']); });
test('lost save reply recovers after reload and persists only request identity', async ({ page, fixture: f }) => {
    await login(page, f);
    let lost = false;
    await page.route('**/api/leads', async (route) => {
        if (!lost && route.request().method() === 'POST' && route.request().postDataJSON()?.operation === 'create') {
            lost = true;
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    const d = await form(page);
    await d.getByRole('button', { name: 'Create Lead', exact: true }).click();
    await expect(d.getByRole('alert')).toBeVisible();
    const storage = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('p11.lead-record.v1:')).map(([, v]) => JSON.parse(v)));
    expect(storage).toHaveLength(1);
    expect(Object.keys(storage[0])).toEqual(['id']);
    await page.reload();
    await page.getByRole('button', { name: 'Check lead request' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Lead decision saved' })).toBeVisible();
    expect(await rows(f)).toHaveLength(1);
});
test('unused cancellation fences a delayed create without losing recorded history', async ({ page, fixture: f }) => {
    await login(page, f);
    let original: unknown;
    await page.route('**/api/leads', async (route) => {
        if (route.request().postDataJSON()?.operation === 'create') {
            original = route.request().postDataJSON();
            await route.abort();
        }
        else
            await route.continue();
    });
    const d = await form(page);
    await d.getByRole('button', { name: 'Create Lead', exact: true }).click();
    await expect(d.getByRole('alert')).toBeVisible();
    await d.getByRole('button', { name: 'Cancel unused lead request' }).click();
    await expect(d.getByRole('status')).toContainText('Unused lead request cancelled');
    await page.unroute('**/api/leads');
    const late = await page.request.post('/api/leads', { headers: { origin }, data: original });
    expect((await late.json()).status).toBe('cancelled_request');
    expect(await rows(f)).toHaveLength(0);
});
test('stale edit keeps entered fields visible and cannot overwrite a concurrent contact change', async ({ page, fixture: f }) => { await login(page, f); await create(page); await page.getByText('Taylor Example', { exact: true }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click(); const d = page.getByRole('dialog'); await d.getByLabel('First Name', { exact: true }).fill('Unconfirmed edit'); const lead = (await rows(f))[0]; await f.db.from('leads').update({ phone: '+15551234567' }).eq('id', lead.id); await d.getByRole('button', { name: 'Save Changes', exact: true }).click(); await expect(d.getByRole('alert')).toContainText('The lead changed'); await expect(d.getByLabel('First Name', { exact: true })).toHaveValue('Unconfirmed edit'); expect((await rows(f))[0]).toMatchObject({ first_name: 'Taylor', phone: '+15551234567' }); });
test('current role withdrawal blocks changes and reloaded viewers retain read-only access', async ({ page, fixture: f }) => { await login(page, f); await create(page); const lead = (await rows(f))[0]; sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`); expect((await decision(page, f, { operation: 'status', leadId: lead.id, revision: lead.record_revision, status: 'lost', reason: '' })).status()).toBe(403); await page.reload(); await expect(page.getByRole('button', { name: 'Add Lead', exact: true }).first()).toBeDisabled(); await page.getByText('Taylor Example', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled(); await page.getByRole('button', { name: 'Activity', exact: true }).click(); await expect(page.getByRole('region', { name: 'Lead record history' })).toContainText('Lead created'); });
test('changed follow-up steps are held before lead creation', async ({ page, fixture: f }) => { await login(page, f); const d = await form(page); await d.getByRole('checkbox', { name: 'Reviewed welcome email' }).check(); await f.db.from('workflow_definitions').update({ steps: [{ action: 'wait', delay_hours: 300 }], updated_at: new Date().toISOString() }).eq('id', f.workflow); await d.getByRole('button', { name: 'Create Lead', exact: true }).click(); await expect(d.getByRole('alert')).toContainText('active follow-up changed'); expect(await rows(f)).toHaveLength(0); });
test('explicit creation enrollment and CRM setup gaps are accurately recorded', async ({ page, fixture: f }) => {
    await login(page, f);
    const d = await form(page);
    await d.getByRole('checkbox', { name: 'Reviewed welcome email' }).check();
    await d.getByRole('checkbox', { name: 'Prepare a CRM transfer' }).check();
    await d.getByRole('button', { name: 'Create Lead', exact: true }).click();
    await expect(d).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'CRM setup or qualification needs review' })).toBeVisible();
    const lead = (await rows(f))[0];
    expect((await f.db.from('lead_workflows').select('id').eq('lead_id', lead.id)).data).toHaveLength(1);
    const command = await f.db.from('lead_record_commands').select('after_state').eq('id', lead.id).single();
    expect((command.data!.after_state as {
        crmPreparation: {
            state: string;
        };
    }).crmPreparation.state).toBe('configuration_required');
});
