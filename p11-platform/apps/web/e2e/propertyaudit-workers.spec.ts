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
        const db = service(), email = 'audit-worker-browser-' + randomUUID() + '@p11.test', created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const id = created.data.user!.id, org = randomUUID(), property = randomUUID();
        try {
            sql(`BEGIN;INSERT INTO organizations(id,name)VALUES('${org}','Audit worker browser fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE profiles SET org_id='${org}',role='admin'WHERE id='${id}';INSERT INTO properties(id,org_id,name,website_url)VALUES('${property}','${org}','Audit worker fixture property','https://audit-fixture.invalid');COMMIT;`);
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
async function read(p: Page, f: Fixture, kind = 'context', id?: string) { const r = await p.request.get('/api/propertyaudit/decisions', { params: { propertyId: f.property, kind, ...(id ? { id } : {}) } }); expect(r.status()).toBe(200); return r.json(); }
async function decision(p: Page, f: Fixture, input: Record<string, unknown>) { return p.request.post('/api/propertyaudit/decisions', { headers: { origin }, data: { id: randomUUID(), propertyId: f.property, expectedActorId: f.id, ...input } }); }
async function queueFixture(p: Page, f: Fixture) { const context = await read(p, f); const r = await decision(p, f, { operation: 'run_request', sourceHash: context.context.hash, modelHash: context.models.hash, surfaces: ['chatgpt'], executionCount: 1, includeSiteCrawl: true, useLocalFixture: true }); expect(r.status()).toBe(200); return (await r.json()).runIds[0] as string; }
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




async function setup(p:Page,f:Fixture){await login(p,f);await expect(await add(p,'Captured crawl question')).toBeHidden();const runId=await queueFixture(p,f),r=await f.db.from('geo_runs').select('batch_id').eq('id',runId).single();expect(r.error).toBeNull();const crawlId=r.data!.batch_id!,lease=await rpc(f,'claim_geo_site_crawl',{p_crawl_id:crawlId});return {crawlId,token:lease.lease_token}}
async function capture(f:Fixture,crawlId:string,token:string,kind:string,payload:Record<string,unknown>,apply=true){const id=randomUUID();expect((await rpc(f,'retain_geo_crawl_receipt',{p_id:id,p_crawl_id:crawlId,p_token:token,p_kind:kind,p_payload:payload})).state).toBe('retained');if(apply)await rpc(f,'apply_geo_crawl_receipt',{p_id:id,p_crawl_id:crawlId,p_token:token});return id}
async function panel(p:Page){await p.getByRole('button',{name:'history',exact:true}).click();await p.getByRole('button',{name:'Refresh worker history',exact:true}).click();await p.getByRole('button',{name:'Inspect website crawl',exact:true}).click();const view=p.getByRole('region',{name:'Captured crawl output'});await expect(view.getByRole('button',{name:'Refresh captured output',exact:true})).toBeEnabled();return view}
test('retained pages are inspectable with applied status and responsive evidence',async({page,fixture:f},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const{crawlId,token}=await setup(page,f);
 await capture(f,crawlId,token,'pages',{pages:[{url:'https://audit-fixture.invalid',title:'Exact synthetic retained page',status_code:200,content_type:'text/html',content:{},forms:[],provenance:{synthetic:true}}]});
 const view=await panel(page);await expect(view.getByText(/1 retained captures/)).toBeVisible();await expect(view.getByText(/pages · Applied/)).toBeVisible();await view.getByRole('button',{name:'Inspect captured pages',exact:true}).click();await expect(view.getByText('Exact synthetic retained page',{exact:true})).toBeVisible();await expect(view.getByText('lease hash',{exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('crawl-evidence-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await view.getByRole('heading',{name:'Captured crawl output',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('crawl-evidence-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([])
})
test('stopped crawl retains returning output without restarting or applying it',async({page,fixture:f})=>{
 const{crawlId,token}=await setup(page,f);const view=await panel(page);await page.getByLabel('Website crawl decision reason',{exact:true}).fill('Stop while preserving any returning captured evidence.');await page.getByRole('button',{name:'Stop website crawl',exact:true}).click();await expect(page.getByRole('button',{name:'Request linked website crawl retry',exact:true})).toBeVisible();
 await capture(f,crawlId,token,'completed',{findings:[],synthetic:'Returning detector output'},true);await view.getByRole('button',{name:'Refresh captured output',exact:true}).click();await expect(view.getByText(/Retained; not applied/)).toBeVisible();await view.getByRole('button',{name:'Inspect captured completed',exact:true}).click();await expect(view.getByText('Returning detector output',{exact:true})).toBeVisible();const r=await f.db.from('geo_site_crawls').select('status,pages_crawled').eq('id',crawlId).single();expect(r.data).toMatchObject({status:'failed',pages_crawled:0});
})
test('complete capture paging fences changed history and scope',async({page,fixture:f})=>{
 const{crawlId,token}=await setup(page,f);for(let n=0;n<27;n++)await capture(f,crawlId,token,'checkpoint',{crawl_state:{frontier:[],pages_crawled:0,synthetic:n}},false);const view=await panel(page);await expect(view.getByText(/27 retained captures/)).toBeVisible();await view.getByRole('button',{name:'Next captures',exact:true}).click();await expect(view.getByText(/26–27/)).toBeVisible();await expect(view.getByRole('button',{name:'Next captures',exact:true})).toBeDisabled();await capture(f,crawlId,token,'checkpoint',{crawl_state:{frontier:[],pages_crawled:0,synthetic:28}},false);await view.getByRole('button',{name:'Previous captures',exact:true}).click();await expect(view.getByRole('alert')).toContainText('inventory changed');await view.getByRole('button',{name:'Refresh captured output',exact:true}).click();await expect(view.getByText(/28 retained captures/)).toBeVisible();const response=await page.request.get('/api/propertyaudit/crawl-receipts',{params:{propertyId:f.property,crawlId:randomUUID()}});expect(response.status()).toBe(404)
})
test('role withdrawal prevents applying captured output while retaining readable history',async({page,fixture:f})=>{
 const{crawlId,token}=await setup(page,f);const id=await capture(f,crawlId,token,'pages',{pages:[{url:'https://audit-fixture.invalid',title:'Late authorized capture'}]},false);sql(`BEGIN;SELECT set_config('p11.team_scope','${f.org}',true);UPDATE profiles SET role='viewer'WHERE id='${f.id}';COMMIT;`);expect((await rpc(f,'apply_geo_crawl_receipt',{p_id:id,p_crawl_id:crawlId,p_token:token})).state).toBe('authorization_changed');await page.reload();const view=await panel(page);await expect(view.getByText(/Retained; not applied/)).toBeVisible();await expect(page.getByRole('button',{name:'Request linked website crawl retry',exact:true})).toBeDisabled();const r=await f.db.from('geo_crawl_pages').select('id').eq('crawl_id',crawlId);expect(r.data).toHaveLength(0)
})
