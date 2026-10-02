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
        const db = service(), email = 'audit-read-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID();
        try {
            sql(`BEGIN;INSERT INTO organizations(id,name)VALUES('${org}','Audit read browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO properties(id,org_id,name,website_url)VALUES('${property}','${org}','Audit read fixture property','https://audit-fixture.invalid');COMMIT;`);
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
async function completeFixture(p: Page, f: Fixture) { const runId = await queueFixture(p, f), lease = await rpc(f, 'claim_geo_execution', { p_run_id: runId }), next = await rpc(f, 'advance_geo_execution', { p_run_id: runId, p_token: lease.lease_token }), invocation = await rpc(f, 'start_geo_provider_invocation', { p_run_id: runId, p_token: lease.lease_token, p_item_id: next.item.id }); expect(invocation.state).toBe('claimed'); await rpc(f, 'finish_geo_provider_invocation', { p_id: invocation.invocationId, p_token: lease.lease_token, p_result: { answer: { run_id: runId, query_id: (await queries(f))[0].id, presence: false, llm_rank: null, link_rank: null, sov: 0, answer_summary: 'ACTUAL retained synthetic audit answer', natural_response: 'ACTUAL retained synthetic audit answer', ordered_entities: [], flags: [], raw_json: { synthetic: true }, analysis_method: 'local_fixture' }, citations: [{ url: 'https://fixture.invalid/evidence', domain: 'fixture.invalid', entity_ref: 'Fixture', is_brand_domain: false }], score: { presence: false, score: 0, sov: 0 } } }); await rpc(f, 'apply_geo_provider_invocation', { p_id: invocation.invocationId, p_run_id: runId, p_token: lease.lease_token }); expect((await rpc(f, 'finish_geo_execution', { p_run_id: runId, p_token: lease.lease_token, p_aggregate: { overall_score: 0, visibility_pct: 0, breakdown: { position: 0, link: 0, sov: 0, accuracy: 0 } } })).state).toBe('completed'); return runId; }

test('complete question history preserves original wording, paginates and labels synthetic evidence', async ({page,fixture:f},info)=>{
 await login(page,f); await expect(await add(page,'ORIGINAL retained question')).toBeHidden();
 const runId=await completeFixture(page,f), query=(await queries(f))[0], historical= randomUUID();
 sql(`BEGIN; INSERT INTO geo_runs(id,property_id,surface,model_name,status,started_at,measurement_mode,archived_at)VALUES('${historical}','${f.property}','chatgpt','historical-fixture','completed','2030-01-01','natural','2030-01-02'); INSERT INTO geo_answers(run_id,query_id,presence,created_at,answer_summary)SELECT '${historical}','${query.id}',false,'2030-01-01'::timestamptz+make_interval(secs=>n),'Historical fixture answer' FROM generate_series(1,57)n; UPDATE geo_queries SET text='CURRENT edited question'WHERE id='${query.id}';COMMIT;`);
 await page.reload(); await page.getByRole('button',{name:/^Queries \(/}).click(); const row=page.locator('tr[id^="query-row-"]').filter({hasText:'CURRENT edited question'});await expect(row).toBeVisible();await row.click();
 await expect(page.getByText('Showing 1–25 of 58 retained answers.',{exact:false})).toBeVisible();await expect(page.getByRole('cell',{name:/Original question context not retained/}).first()).toBeVisible();
 await page.getByRole('button',{name:'Next answers',exact:true}).click();await expect(page.getByText('Showing 26–50 of 58 retained answers.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Next answers',exact:true}).click();await expect(page.getByText('Showing 51–58 of 58 retained answers.',{exact:false})).toBeVisible();await expect(page.getByRole('cell',{name:/^ORIGINAL retained question/})).toContainText('Synthetic');await expect(page.getByRole('button',{name:'Next answers',exact:true})).toBeDisabled();
 await page.screenshot({path:info.outputPath('audit-original-history-desktop.png')});await page.setViewportSize({width:390,height:844});await page.getByText('Showing 51–58 of 58 retained answers.',{exact:false}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('audit-original-history-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const score=await page.request.get('/api/propertyaudit/score',{params:{propertyId:f.property}});expect(score.status()).toBe(200);expect((await score.json()).score).toBeNull();
 const explicit=await page.request.get('/api/propertyaudit/analysis',{params:{propertyId:f.property,batchId:(await f.db.from('geo_runs').select('batch_id').eq('id',runId).single()).data!.batch_id!}});expect(explicit.status()).toBe(200);
});
test('complete latest batch, honest failed state, property scope and default exclusions',async({page,fixture:f})=>{
 await login(page,f);const batch=randomUUID(),hidden=randomUUID();
 sql(`BEGIN; INSERT INTO geo_runs(property_id,batch_id,surface,model_name,status,started_at,measurement_mode)SELECT '${f.property}','${batch}','chatgpt','terminal-fixture','failed','2028-01-01','natural'FROM generate_series(1,17);INSERT INTO geo_runs(property_id,batch_id,surface,model_name,status,started_at,measurement_mode)VALUES('${f.property}','${hidden}','chatgpt','synthetic-fixture','completed','2029-01-01','local_fixture');COMMIT;`);
 const analysis=await page.request.get('/api/propertyaudit/analysis',{params:{propertyId:f.property}});expect(analysis.status()).toBe(200);const body=await analysis.json();expect(body.runs).toHaveLength(17);expect(body.batchStatus).toBe('failed');expect(body.summary.scoreDifference).toBeNull();
 const insights=await page.request.get('/api/propertyaudit/insights',{params:{propertyId:f.property}});expect(insights.status()).toBe(200);const detail=await insights.json();expect(detail.coverage.runs).toBe(17);expect(detail.batchStatus.status).toBe('failed');expect(detail.summary.brandSOV).toBeNull();expect(detail.competitors).toEqual([]);
 const list=await page.request.get('/api/propertyaudit/runs',{params:{propertyId:f.property,limit:'5',through:'2030-01-01'}});expect(list.status()).toBe(200);expect(await list.json()).toMatchObject({total:17,nextOffset:5});
 const last=await page.request.get('/api/propertyaudit/runs',{params:{propertyId:f.property,limit:'5',offset:'15',through:'2030-01-01'}});expect((await last.json()).runs).toHaveLength(2);
 const invalid=await page.request.get('/api/propertyaudit/runs',{params:{propertyId:f.property,limit:'100000'}});expect(invalid.status()).toBe(400);
 const other=await page.request.get('/api/propertyaudit/analysis',{params:{propertyId:f.property,batchId:randomUUID()}});expect(other.status()).toBe(404);
});
test('native headline retains original query categories and withholds comparisons after source changes',async({page,fixture:f})=>{
 await login(page,f);await expect(await add(page,'Original branded question')).toBeHidden();const query=(await queries(f))[0],ids=[randomUUID(),randomUUID()];
 // Terminal local fixture setup, with enrolled captured context but no queued/provider work.
 sql(`BEGIN;INSERT INTO geo_runs(id,property_id,surface,model_name,status,started_at,measurement_mode)VALUES('${ids[0]}','${f.property}','chatgpt','fixture-model','completed','2026-08-01','natural'),('${ids[1]}','${f.property}','chatgpt','fixture-model','completed','2026-09-01','natural');INSERT INTO geo_execution_jobs(run_id,property_id,surface,snapshot,state)SELECT id,property_id,'chatgpt',jsonb_build_object('property',jsonb_build_object('name',CASE WHEN id='${ids[0]}'THEN'Original name'ELSE'Changed name'END),'config','{}'::jsonb),'completed'FROM geo_runs WHERE id IN('${ids[0]}','${ids[1]}');INSERT INTO geo_answers(run_id,query_id,presence,llm_rank)VALUES('${ids[0]}','${query.id}',true,1),('${ids[1]}','${query.id}',false,null);INSERT INTO geo_execution_items(run_id,ordinal,query_snapshot,state,answer_id)SELECT run_id,1,jsonb_build_object('id',query_id,'text','Original branded question','type','branded','weight',1),'completed',id FROM geo_answers WHERE run_id IN('${ids[0]}','${ids[1]}');UPDATE geo_queries SET text='Changed discovery question',type='local'WHERE id='${query.id}';COMMIT;`);
 const r=await page.request.get('/api/propertyaudit/score',{params:{propertyId:f.property}});expect(r.status()).toBe(200);const b=await r.json();expect(b.score.brandedRecognitionPct).toBe(0);expect(b.score.discoveryMentionPct).toBeNull();expect(b.score.trend).toBeNull();expect(b.comparisonAvailable).toBe(false);expect(b.coverage[0]).toMatchObject({retainedAnswers:1,capturedExecutions:1});
 await page.reload();await page.getByText('Measurement coverage',{exact:true}).click();await expect(page.getByText('chatgpt: 1 retained answers / 1 captured executions')).toBeVisible();
});
