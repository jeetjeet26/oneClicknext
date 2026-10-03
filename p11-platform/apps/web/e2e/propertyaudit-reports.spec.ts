import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
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
        const db = service(), email = 'audit-report-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID();
        try {
            sql(`BEGIN;INSERT INTO organizations(id,name)VALUES('${org}','Audit report browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO properties(id,org_id,name,website_url)VALUES('${property}','${org}','Audit report fixture property','https://audit-fixture.invalid');COMMIT;`);
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
async function openReports(p: Page) { await p.getByRole('button', { name: 'Reports & exports', exact: true }).click(); const dialog = p.getByRole('dialog', { name: 'Audit reports and exports' }); await expect(dialog.getByRole('heading', { name: /^Saved reports \(\d+\)$/ })).toBeVisible(); return dialog; }
async function saveCsv(p: Page) { const d = await openReports(p); await d.getByLabel('Report output format').selectOption('queries_csv'); await d.getByRole('button', { name: 'Save report', exact: true }).click(); await expect(d.getByRole('button', { name: 'Download saved report', exact: true })).toBeVisible(); return d; }
async function records(f: Fixture) { const r = await f.db.from('geo_report_records').select('*').eq('property_id', f.property).order('created_at'); expect(r.error).toBeNull(); return r.data!; }
async function downloadReport(p: Page) { const got = p.waitForEvent('download'); await p.getByRole('button', { name: 'Download saved report', exact: true }).click(); const file = await got; expect(await file.failure()).toBeNull(); await expect(p.getByRole('button', { name: 'Download saved report', exact: true })).toBeEnabled(); return { bytes: readFileSync((await file.path())!, 'utf8'), name: file.suggestedFilename() }; }
async function completeFixture(p: Page, f: Fixture) { const runId = await queueFixture(p, f), lease = await rpc(f, 'claim_geo_execution', { p_run_id: runId }), next = await rpc(f, 'advance_geo_execution', { p_run_id: runId, p_token: lease.lease_token }), invocation = await rpc(f, 'start_geo_provider_invocation', { p_run_id: runId, p_token: lease.lease_token, p_item_id: next.item.id }); expect(invocation.state).toBe('claimed'); await rpc(f, 'finish_geo_provider_invocation', { p_id: invocation.invocationId, p_token: lease.lease_token, p_result: { answer: { run_id: runId, query_id: (await queries(f))[0].id, presence: false, llm_rank: null, link_rank: null, sov: 0, answer_summary: 'ACTUAL retained synthetic audit answer', natural_response: 'ACTUAL retained synthetic audit answer', ordered_entities: [], flags: [], raw_json: { synthetic: true }, analysis_method: 'local_fixture' }, citations: [{ url: 'https://fixture.invalid/evidence', domain: 'fixture.invalid', entity_ref: 'Fixture', is_brand_domain: false }], score: { presence: false, score: 0, sov: 0 } } }); await rpc(f, 'apply_geo_provider_invocation', { p_id: invocation.invocationId, p_run_id: runId, p_token: lease.lease_token }); expect((await rpc(f, 'finish_geo_execution', { p_run_id: runId, p_token: lease.lease_token, p_aggregate: { overall_score: 0, visibility_pct: 0, breakdown: { position: 0, link: 0, sov: 0, accuracy: 0 } } })).state).toBe('completed'); return runId; }
test('retained question export, exact redownload, private history and mobile layout', async ({ page, fixture: f }, info) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await login(page, f); await expect(await add(page, 'PRIVATE original export wording')).toBeHidden(); const dialog = await saveCsv(page), first = await downloadReport(page); expect(first.name).toMatch(/\.csv$/); expect(first.bytes).toContain('PRIVATE original export wording'); await expect(dialog).toContainText('Download initiated by the browser'); const saved = (await records(f))[0]; await f.db.from('geo_queries').update({ text: 'LATER replacement words' }).eq('property_id', f.property); const second = await downloadReport(page); expect(second.bytes).toBe(first.bytes); await expect(dialog).toContainText('download initiated'); const events = await f.db.from('shared_action_events').select('action,request,result,evidence,training_eligible').eq('property_id', f.property).like('action', 'audit.report.%'); expect(events.data?.filter(x => x.action === 'audit.report.download_prepared')).toHaveLength(2); expect(events.data?.filter(x => x.action === 'audit.report.reported')).toHaveLength(2); expect(events.data?.every(x => !x.training_eligible)).toBe(true); expect(JSON.stringify(events.data)).not.toContain('PRIVATE'); expect(saved.state).toBe('ready'); await page.screenshot({ path: info.outputPath('retained-reports-desktop.png') }); await page.setViewportSize({ width: 390, height: 844 }); await dialog.getByRole('heading', { name: 'Saved report detail' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('retained-reports-mobile.png') }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]); });
test('lost report reply recovers after reload without recapturing source', async ({ page, fixture: f }) => {
    await login(page, f);
    await expect(await add(page, 'Missed reply source')).toBeHidden();
    let lost = false;
    await page.route('**/api/propertyaudit/reports', async (route) => {
        if (!lost && route.request().method() === 'POST' && route.request().postDataJSON().operation === 'prepare') {
            lost = true;
            await route.fetch();
            await route.abort();
        }
        else
            await route.continue();
    });
    const d = await openReports(page);
    await d.getByLabel('Report output format').selectOption('queries_csv');
    await d.getByRole('button', { name: 'Save report', exact: true }).click();
    await expect(d.getByRole('button', { name: 'Check saved report' })).toBeVisible();
    await expect.poll(async () => (await records(f)).length).toBe(1);
    const storage = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('p11-audit-report:')).map(([, v]) => JSON.parse(v)));
    expect(Object.keys(storage[0]).sort()).toEqual(['actor', 'id']);
    await page.reload();
    const next = await openReports(page);
    await next.getByRole('button', { name: 'Check saved report' }).click();
    await expect(next).toContainText('No new source was captured');
    expect(await records(f)).toHaveLength(1);
    expect((await downloadReport(page)).bytes).toContain('Missed reply source');
});
test('cancel unused report identity holds a delayed export request', async ({ page, fixture: f }) => {
    await login(page, f);
    let original: unknown;
    await page.route('**/api/propertyaudit/reports', async (route) => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().operation === 'prepare') {
            original = route.request().postDataJSON();
            await route.abort();
        }
        else
            await route.continue();
    });
    const d = await openReports(page);
    await d.getByLabel('Report output format').selectOption('queries_csv');
    await d.getByRole('button', { name: 'Save report', exact: true }).click();
    await d.getByRole('button', { name: 'Cancel pending report' }).click();
    await expect(d).toContainText('Report request cancelled');
    await page.unroute('**/api/propertyaudit/reports');
    const r = await page.request.post('/api/propertyaudit/reports', { headers: { origin }, data: original });
    expect(r.status()).toBe(200);
    expect((await r.json()).status).toBe('cancelled');
    expect((await records(f))[0]).toMatchObject({ state: 'cancelled', source: null, artifact: null });
});
test('interrupted rendering resumes the exact saved question source', async ({ page, fixture: f }) => { await login(page, f); await expect(await add(page, 'ORIGINAL prepared text')).toBeHidden(); const id = randomUUID(); await rpc(f, 'prepare_geo_report', { p_id: id, p_actor_id: f.id, p_property_id: f.property, p_options: { format: 'queries_csv', template: 'comprehensive', sections: ['summary'] } }); await f.db.from('geo_queries').update({ text: 'CHANGED after capture' }).eq('property_id', f.property); const d = await openReports(page); await d.getByRole('button').filter({ hasText: 'Active questions CSV · prepared' }).click(); await d.getByRole('button', { name: 'Resume rendering saved source' }).click(); await expect(d.getByRole('button', { name: 'Download saved report' })).toBeVisible(); const file = await downloadReport(page); expect(file.bytes).toContain('ORIGINAL prepared text'); expect(file.bytes).not.toContain('CHANGED after capture'); expect(await records(f)).toHaveLength(1); });
test('actual retained measurement renders original wording and honest synthetic coverage', async ({ page, fixture: f }, info) => { await login(page, f); await expect(await add(page, 'ORIGINAL measured wording')).toBeHidden(); const runId = await completeFixture(page, f); await f.db.from('geo_queries').update({ text: 'CURRENT unrelated wording' }).eq('property_id', f.property); const id = randomUUID(), res = await page.request.post('/api/propertyaudit/reports', { headers: { origin }, data: { id, expectedActorId: f.id, propertyId: f.property, operation: 'prepare', options: { format: 'html', template: 'comprehensive', sections: ['summary', 'scores', 'models', 'competitors', 'recommendations', 'queries', 'appendix'], runId } } }); expect(res.status()).toBe(200); const d = await openReports(page); await d.getByRole('button').filter({ hasText: 'Print-ready HTML · ready' }).click(); const file = await downloadReport(page); expect(file.name).toMatch(/\.html$/); expect(file.bytes).toContain('ORIGINAL measured wording'); expect(file.bytes).not.toContain('CURRENT unrelated wording'); expect(file.bytes).toContain('ACTUAL retained synthetic audit answer'); expect(file.bytes).toContain('SYNTHETIC LOCAL TEST EVIDENCE'); expect(file.bytes).toContain('https://fixture.invalid/evidence'); const preview = await page.context().newPage(); writeFileSync(info.outputPath('retained-audit-artifact.html'),file.bytes); await preview.setContent(file.bytes); await preview.screenshot({ path: info.outputPath('retained-audit-artifact.png'), fullPage: true }); await preview.pdf({ path: info.outputPath('retained-audit-artifact.pdf'), printBackground: true, format: 'Letter' }); await preview.setViewportSize({ width: 390, height: 844 }); expect(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await preview.close(); });
test('complete report history pagination and current viewer export permission', async ({ page, fixture: f }) => {
    await login(page, f);
    for (let n = 0; n < 28; n++)
        await rpc(f, 'prepare_geo_report', { p_id: randomUUID(), p_actor_id: f.id, p_property_id: f.property, p_options: { format: 'queries_csv', template: 'executive', sections: ['summary'] } });
    sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`);
    const d = await openReports(page);
    await expect(d).toContainText('Saved reports (28)');
    await d.getByRole('button', { name: 'More reports' }).click();
    await expect(d.getByRole('button').filter({ hasText: 'Active questions CSV · prepared' })).toHaveCount(3);
    await d.getByRole('button').filter({ hasText: 'Active questions CSV · prepared' }).first().click();
    await d.getByRole('button', { name: 'Resume rendering saved source' }).click();
    await expect(d.getByRole('button', { name: 'Download saved report' })).toBeVisible();
    expect((await downloadReport(page)).name).toMatch(/\.csv$/);
    expect((await page.request.get('/api/propertyaudit/export?runId=' + randomUUID())).status()).toBe(410);
    expect((await page.request.post('/api/propertyaudit/generate-report', { data: { propertyId: f.property }, headers: { origin } })).status()).toBe(410);
});
