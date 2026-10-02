import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServiceClient } from '@/utils/supabase/admin'
import { visitMonitoringSweep } from './monitoring-sweep'

describe.skipIf(process.env.SITEFORGE_LOCAL_DATABASE_TEST !== '1')('local monitoring sweep progress', () => {
  const marker = randomUUID(), ids = Array.from({length:105}, () => randomUUID()).sort()
  let service: ReturnType<typeof createServiceClient>
  let parent: { singleton: boolean; after_id: string|null; through_id: string|null; lease_token: string|null; lease_until: string|null; started_at: string|null }
  beforeAll(async () => {
    if (!['localhost','127.0.0.1'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname)) throw new Error('Local database required')
    service=createServiceClient()
    const snapshot=await service.from('siteforge_monitoring_sweep').select('*').single()
    if(snapshot.error||!snapshot.data)throw snapshot.error
    parent=snapshot.data
    if(parent.lease_token)throw new Error('A monitoring sweep is active; do not alter its cursor')
    const created=await service.from('property_websites').insert(ids.map(id=>({id,org_id:'22222222-2222-2222-2222-222222222222',property_id:'33333333-3333-3333-3333-333333333333',
      generation_status:'complete',generation_input:{sweepFixture:marker},production_url:'https://sweep-fixture.test',production_certified_at:new Date().toISOString()})))
    if(created.error)throw created.error
  })
  beforeEach(async()=>{
    const reset=await service.from('siteforge_monitoring_sweep').update({after_id:null,through_id:null,lease_token:null,lease_until:null,started_at:null}).eq('singleton',true)
    if(reset.error)throw reset.error
  })
  afterAll(async()=>{
    if(!service)return
    if(parent){const restored=await service.from('siteforge_monitoring_sweep').update(parent).eq('singleton',true);if(restored.error)throw restored.error}
    execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{
      input:`BEGIN; SET LOCAL session_replication_role=replica;
        DELETE FROM siteforge_launch_policies WHERE website_id IN (SELECT id FROM property_websites WHERE generation_input->>'sweepFixture'='${marker}');
        SET LOCAL session_replication_role=origin;
        DELETE FROM property_websites WHERE generation_input->>'sweepFixture'='${marker}'; COMMIT;`,stdio:['pipe','pipe','pipe']})
    const remain=await service.from('property_websites').select('id').in('id',ids);expect(remain.data).toEqual([])
  })
  it('visits more than 100 websites exactly once across stable pages',async()=>{
    const visited:string[]=[]
    const result=await visitMonitoringSweep({token:randomUUID(),deadline:Date.now()+60_000,visit:async rows=>{visited.push(...rows.map(row=>row.id))}},service)
    expect(result.coverageComplete).toBe(true);expect(new Set(visited).size).toBe(visited.length)
    expect(ids.every(id=>visited.includes(id))).toBe(true);expect(visited).toEqual([...visited].sort())
  })
  it('resumes after a bounded run without skipping or restarting the first page',async()=>{
    const visited:string[]=[];let clock=0
    const visit=async(rows:{id:string}[])=>{visited.push(...rows.map(row=>row.id));if(rows.length)clock=2}
    const first=await visitMonitoringSweep({token:randomUUID(),deadline:1,now:()=>clock,visit},service)
    expect(first.coverageComplete).toBe(false);expect(first.processed).toBe(8)
    const next=await visitMonitoringSweep({token:randomUUID(),deadline:Date.now()+60_000,visit},service)
    expect(next.coverageComplete).toBe(true);expect(new Set(visited).size).toBe(visited.length);expect(ids.every(id=>visited.includes(id))).toBe(true)
  })
  it('allows only one concurrent owner and rejects an expired owner checkpoint',async()=>{
    const tokens=[randomUUID(),randomUUID()]
    const claims=await Promise.all(tokens.map(p_token=>service.rpc('claim_siteforge_monitoring_sweep',{p_token})))
    expect(claims.filter(result=>(result.data as {claimed:boolean})?.claimed)).toHaveLength(1)
    const winner=claims.findIndex(result=>(result.data as {claimed:boolean})?.claimed)
    const attempt=await visitMonitoringSweep({token:randomUUID(),deadline:Date.now()+60_000,visit:async()=>{throw new Error('must not run')}},service)
    expect(attempt.claimed).toBe(false)
    await service.from('siteforge_monitoring_sweep').update({lease_until:'2000-01-01T00:00:00Z'}).eq('singleton',true)
    const replacement=await service.rpc('claim_siteforge_monitoring_sweep',{p_token:randomUUID()});expect((replacement.data as {claimed:boolean}).claimed).toBe(true)
    const stale=await service.rpc('checkpoint_siteforge_monitoring_sweep',{p_token:tokens[winner],p_after_id:null,p_complete:true});expect(stale.error).toBeTruthy()
  })
  it('retains the last checkpoint if processing a later page is interrupted',async()=>{
    let pages=0
    await expect(visitMonitoringSweep({token:randomUUID(),deadline:Date.now()+60_000,visit:async rows=>{if(rows.length&&++pages===2)throw new Error('Injected interruption')}},service)).rejects.toThrow('Injected interruption')
    const current=await service.from('siteforge_monitoring_sweep').select('*').single();expect(current.data?.after_id).toBeTruthy();expect(current.data?.lease_token).toBeNull()
    const completed=await visitMonitoringSweep({token:randomUUID(),deadline:Date.now()+60_000,visit:async()=>{}},service);expect(completed.coverageComplete).toBe(true)
  })
  it('keeps the cursor and RPC permissions unavailable to browser roles',async()=>{
    const result=execFileSync('docker',['exec','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-Atc',
      "select has_function_privilege('authenticated','public.finalize_siteforge_health_run(uuid,text,jsonb,jsonb)','execute') or has_function_privilege('anon','public.claim_siteforge_monitoring_sweep(uuid)','execute') or has_table_privilege('authenticated','public.siteforge_monitoring_sweep','select')"],{encoding:'utf8'})
    expect(result.trim()).toBe('f')
  })
})
