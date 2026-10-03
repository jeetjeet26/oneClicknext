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
        const db = service(), email = 'audit-evaluation-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID();
        try {
            sql(`BEGIN;INSERT INTO organizations(id,name)VALUES('${org}','Audit evaluation browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO properties(id,org_id,name,website_url)VALUES('${property}','${org}','Audit evaluation fixture property','https://audit-fixture.invalid');COMMIT;`);
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
async function completeFixture(p: Page, f: Fixture) { const runId = await queueFixture(p, f), lease = await rpc(f, 'claim_geo_execution', { p_run_id: runId }), next = await rpc(f, 'advance_geo_execution', { p_run_id: runId, p_token: lease.lease_token }), invocation = await rpc(f, 'start_geo_provider_invocation', { p_run_id: runId, p_token: lease.lease_token, p_item_id: next.item.id }); expect(invocation.state).toBe('claimed'); await rpc(f, 'finish_geo_provider_invocation', { p_id: invocation.invocationId, p_token: lease.lease_token, p_result: { answer: { run_id: runId, query_id: (await queries(f))[0].id, presence: false, llm_rank: null, link_rank: null, sov: 0, answer_summary: 'ACTUAL retained synthetic audit answer', natural_response: 'Audit evaluation fixture property is mentioned in this actual retained synthetic answer.', ordered_entities: [], flags: [], raw_json: { synthetic: true }, analysis_method: 'local_fixture' }, citations: [{ url: 'https://fixture.invalid/evidence', domain: 'fixture.invalid', entity_ref: 'Fixture', is_brand_domain: false }], score: { presence: false, score: 0, sov: 0 } } }); await rpc(f, 'apply_geo_provider_invocation', { p_id: invocation.invocationId, p_run_id: runId, p_token: lease.lease_token }); expect((await rpc(f, 'finish_geo_execution', { p_run_id: runId, p_token: lease.lease_token, p_aggregate: { overall_score: 0, visibility_pct: 0, breakdown: { position: 0, link: 0, sov: 0, accuracy: 0 } } })).state).toBe('completed'); return runId; }


async function openRun(p:Page){await p.getByRole('button',{name:'history',exact:true}).click();await p.getByRole('region',{name:'Complete audit run history'}).getByRole('button',{name:/chatgpt · completed/}).click();const panel=p.getByRole('region',{name:'Saved audit re-evaluations'});await expect(panel.getByRole('button',{name:'Refresh evaluations',exact:true})).toBeEnabled();await expect(panel.getByRole('heading',{name:/Saved evaluations \(\d+\)/})).toBeVisible();return panel}
async function setup(p:Page,f:Fixture){await login(p,f);await expect(await add(p,'ORIGINAL evaluation question')).toBeHidden();const runId=await completeFixture(p,f);return {runId,panel:await openRun(p)}}
async function prepared(p:Page,f:Fixture){const result=await setup(p,f);await result.panel.getByRole('button',{name:'Prepare score preview',exact:true}).click();await expect(result.panel.getByRole('heading',{name:'Saved evaluation detail · ready',exact:true})).toBeVisible();return result}
async function evaluations(f:Fixture){const r=await f.db.from('geo_evaluations').select('*').eq('property_id',f.property).order('created_at');expect(r.error).toBeNull();return r.data!}
async function getAnswers(f:Fixture,runId:string){const r=await f.db.from('geo_answers').select('*').eq('run_id',runId);expect(r.error).toBeNull();return r.data!}
test('exact-source preview, explicit application, retained originals and responsive evidence',async({page,fixture:f},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const {runId,panel}=await setup(page,f),before=(await getAnswers(f,runId))[0];await f.db.from('geo_queries').update({text:'CURRENT unrelated question'}).eq('property_id',f.property);
 await panel.getByRole('button',{name:'Prepare score preview',exact:true}).click();await expect(panel.getByRole('heading',{name:'Saved evaluation detail · ready',exact:true})).toBeVisible();await expect(panel.getByRole('cell',{name:'ORIGINAL evaluation question',exact:true})).toBeVisible();await expect(panel).not.toContainText('CURRENT unrelated question');expect((await getAnswers(f,runId))[0].presence).toBe(false);
 await panel.getByLabel('Evaluation decision reason').fill('Reviewed the original retained response and captured property identity');await panel.getByRole('button',{name:'Apply reviewed scores',exact:true}).click();await expect(panel.getByRole('heading',{name:'Saved evaluation detail · applied',exact:true})).toBeVisible();const after=(await getAnswers(f,runId))[0];expect(after.presence).toBe(true);expect(after.natural_response).toBe(before.natural_response);expect(after.raw_json).toEqual(before.raw_json);const rows=await evaluations(f);expect(rows).toHaveLength(1);expect((rows[0].source as {answers:{answer:{presence:boolean}}[]}).answers[0].answer.presence).toBe(false);expect(rows[0].state).toBe('applied');
 const event=await f.db.from('shared_action_events').select('action,actor_id,service_principal,training_eligible').eq('property_id',f.property).like('action','audit.evaluation.%');expect(event.data?.map(e=>e.action).sort()).toEqual(['audit.evaluation.applied','audit.evaluation.requested']);expect(event.data?.every(e=>e.actor_id===f.id&&!e.training_eligible)).toBe(true);
 await panel.getByRole('heading',{name:'Saved evaluation detail · applied',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('audit-evaluation-desktop.png')});await page.setViewportSize({width:390,height:844});await panel.getByRole('heading',{name:'Saved evaluation detail · applied',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('audit-evaluation-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('lost preparation acknowledgment recovers the same retained preview after reload',async({page,fixture:f})=>{
 const {panel}=await setup(page,f);let lost=false;await page.route('**/api/propertyaudit/evaluations',async route=>{if(!lost&&route.request().method()==='POST'&&route.request().postDataJSON().operation==='prepare'){lost=true;await route.fetch();await route.abort()}else await route.continue()});await panel.getByRole('button',{name:'Prepare score preview',exact:true}).click();await expect(panel.getByRole('button',{name:'Check saved evaluation request'})).toBeVisible();await expect.poll(async()=>(await evaluations(f)).length).toBe(1);await page.reload();const next=await openRun(page);await next.getByRole('button',{name:'Check saved evaluation request'}).click();await expect(next.getByRole('heading',{name:'Saved evaluation detail · ready',exact:true})).toBeVisible();expect(await evaluations(f)).toHaveLength(1);const storage=await page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('p11.audit-evaluation:')));expect(storage).toEqual([]);
});
test('lost application acknowledgment recovers one decision without a second score change',async({page,fixture:f})=>{
 const {panel,runId}=await prepared(page,f);let lost=false;await page.route('**/api/propertyaudit/evaluations',async route=>{if(!lost&&route.request().method()==='POST'&&route.request().postDataJSON().operation==='apply'){lost=true;await route.fetch();await route.abort()}else await route.continue()});await panel.getByLabel('Evaluation decision reason').fill('Reviewed exact preview');await panel.getByRole('button',{name:'Apply reviewed scores',exact:true}).click();await expect(panel.getByRole('button',{name:'Check saved evaluation request'})).toBeVisible();await expect.poll(async()=>(await evaluations(f))[0].state).toBe('applied');const before=await getAnswers(f,runId);await page.reload();const next=await openRun(page);await next.getByRole('button',{name:'Check saved evaluation request'}).click();await expect(next).toContainText('Saved decision recovered: applied');expect(await getAnswers(f,runId)).toEqual(before);const commands=await f.db.from('geo_operator_commands').select('id').eq('property_id',f.property).eq('operation','evaluation_apply');expect(commands.data).toHaveLength(1);
});
test('unused evaluation cancellation holds delayed preparation',async({page,fixture:f})=>{
 const {panel}=await setup(page,f);let original:unknown;await page.route('**/api/propertyaudit/evaluations',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().operation==='prepare'){original=route.request().postDataJSON();await route.abort()}else await route.continue()});await panel.getByRole('button',{name:'Prepare score preview',exact:true}).click();await panel.getByRole('button',{name:'Cancel unused evaluation request'}).click();await expect(panel).toContainText('Request closed: cancelled');await page.unroute('**/api/propertyaudit/evaluations');const r=await page.request.post('/api/propertyaudit/evaluations',{headers:{origin},data:original});expect(r.status()).toBe(200);expect((await r.json()).status).toBe('cancelled');expect((await evaluations(f))[0]).toMatchObject({state:'cancelled',source:null,preview:null});
});
test('changed source holds old approval and allows an explicit discard',async({page,fixture:f})=>{
 const {panel,runId}=await prepared(page,f);const edit=await f.db.from('geo_runs').update({archived_at:new Date().toISOString()}).eq('id',runId);expect(edit.error).toBeNull();await panel.getByLabel('Evaluation decision reason').fill('Review changed source');await panel.getByRole('button',{name:'Apply reviewed scores',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('source evidence changed');expect((await getAnswers(f,runId))[0].presence).toBe(false);await panel.getByRole('button',{name:'Cancel unused evaluation request'}).click();await expect(panel).toContainText('Request closed: cancelled_request');await panel.getByRole('button',{name:'Discard evaluation',exact:true}).click();await expect(panel.getByRole('heading',{name:'Saved evaluation detail · discarded',exact:true})).toBeVisible();
});
test('complete evaluation history and role withdrawal remain enforced',async({page,fixture:f})=>{
 const {panel,runId}=await prepared(page,f),first=(await evaluations(f))[0];for(let n=0;n<26;n++){const r=await f.db.rpc('prepare_geo_evaluation',{p_id:randomUUID(),p_actor_id:f.id,p_property_id:f.property,p_run_id:runId,p_source_hash:first.source_hash!,p_evaluator_version:first.evaluator_version!});expect(r.error).toBeNull()}
 await panel.getByRole('button',{name:'Refresh evaluations',exact:true}).click();await expect(panel.getByRole('heading',{name:'Saved evaluations (27)',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Next evaluations',exact:true}).click();await expect(panel.getByRole('button',{name:/^prepared ·/})).toHaveCount(1);await expect(panel.getByRole('button',{name:'Next evaluations',exact:true})).toBeDisabled();
 sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`);await panel.getByLabel('Evaluation decision reason').fill('Withdrawn role should block this');await panel.getByRole('button',{name:'Apply reviewed scores',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('permission');expect((await getAnswers(f,runId))[0].presence).toBe(false);
});
