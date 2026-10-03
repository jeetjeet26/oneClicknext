/** Opt-in, loopback-only database contract tests. All rows are isolated and removed. */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceClient } from '@/utils/supabase/admin'
import { runSiteForgeHealth, SITEFORGE_HEALTH_CHECKS, type SiteForgeHealthProbes } from './production-health'
import { recordOperationalIncident } from './operational-incidents'
import { IncidentAlertDeliveryError } from './incident-alerts'
import { deliverPendingHealthAlerts } from './health-alerts'
import { listSiteForgeIncidents, runOnePassSiteForgeRepair } from './incidents'

const local = process.env.SITEFORGE_LOCAL_DATABASE_TEST === '1'
describe.skipIf(!local)('local monitoring persistence', () => {
  let service: ReturnType<typeof createServiceClient>
  const websiteId = randomUUID()
  const propertyId = '33333333-3333-3333-3333-333333333333'
  const orgId = '22222222-2222-2222-2222-222222222222'
  const target = { websiteId, propertyId, orgId, artifactId: null, contentHash: null,
    url: 'https://monitoring-fixture.test', purpose: 'production' as const }
  const summary = { processed: 1, failed: 0, unhealthy: 0, degraded: 1, staleJobsRecovered: 0, restoreDrills: { failed: 0, awaitingOperator: 0 } }
  const fetcher = vi.fn<typeof fetch>(async () => new Response('<html lang="en"></html>', { headers: { 'content-type': 'text/html' } }))
  const resolve = vi.fn().mockResolvedValue([{ address: '203.0.113.20', family: 4 }])
  const healthy = Object.fromEntries(SITEFORGE_HEALTH_CHECKS.map(check => [check, async () => ({ passed: true, state: 'healthy', summary: 'Fixture observed' })])) as unknown as SiteForgeHealthProbes
  const run = (probes: Partial<SiteForgeHealthProbes> = {}, scope = target) => runSiteForgeHealth(scope,
    { trigger: 'restore', service, fetch: fetcher, resolve, probes: { ...healthy, ...probes } })
  const failure = async () => ({ passed: false, state: 'failed' as const, severity: 'medium' as const, summary: 'Observed accessibility failure' })
  async function active() {
    const result = await service.from('siteforge_incidents').select('*').eq('website_id', websiteId).neq('status', 'resolved')
    if (result.error) throw result.error
    return result.data
  }
  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Refusing a non-local database')
    service = createServiceClient()
    const saved = await service.from('property_websites').insert({ id: websiteId, org_id: orgId, property_id: propertyId, generation_status: 'complete', generation_input: { monitoringFixture: websiteId } })
    if (saved.error) throw saved.error
  })
  beforeEach(async () => {
    vi.unstubAllEnvs()
    fetcher.mockClear()
    fetcher.mockImplementation(async () => new Response('<html lang="en"></html>', { headers: { 'content-type': 'text/html' } }))
    for (const table of ['siteforge_incidents', 'siteforge_health_runs'] as const) {
      const result = await service.from(table).delete().eq('website_id', websiteId)
      if (result.error) throw result.error
    }
  })
  afterAll(async () => {
    vi.unstubAllEnvs()
    if (!service) return
    // Website creation seeds an append-only launch policy. Remove only this marked
    // fixture's policy under a transaction-local override, then use ordinary FK cleanup.
    execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
      input: `BEGIN; SET LOCAL session_replication_role = replica;
        DELETE FROM siteforge_launch_policies WHERE website_id = '${websiteId}' AND EXISTS (SELECT 1 FROM property_websites WHERE id = '${websiteId}' AND generation_input->>'monitoringFixture' = '${websiteId}');
        SET LOCAL session_replication_role = origin;
        DELETE FROM property_websites WHERE id = '${websiteId}' AND generation_input->>'monitoringFixture' = '${websiteId}'; COMMIT;`,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const remaining = await service.from('property_websites').select('id').eq('id', websiteId)
    expect(remaining.data).toEqual([])
    for (const table of ['siteforge_incidents', 'siteforge_health_runs'] as const) {
      const check = await service.from(table).select('id').eq('website_id', websiteId)
      expect(check.error).toBeNull()
      expect(check.data).toEqual([])
    }
  })
  it('persists a completed healthy observation', async () => {
    const result = await run()
    expect(result.status).toBe('healthy')
    const saved = await service.from('siteforge_health_runs').select('*').eq('id', result.runId).single()
    expect(saved.error).toBeNull()
    expect(saved.data).toMatchObject({ status: 'healthy', evidence: { purpose: 'production', counts: { healthy: 21 } } })
    expect(saved.data?.completed_at).toBeTruthy()
  })
  it('keeps one active incident, preserves ownership, and does not resolve on unavailable evidence', async () => {
    await run({ accessibility: failure })
    const incident = (await active())[0]
    const changed = await service.from('siteforge_incidents').update({ status: 'acknowledged', owner_id: '11111111-1111-1111-1111-111111111111' }).eq('id', incident.id)
    if (changed.error) throw changed.error
    await run({ accessibility: failure })
    const unknown = await run({ accessibility: async () => ({ passed: true, state: 'unobservable', summary: 'Legacy unknown' }) })
    expect(unknown.status).toBe('degraded')
    expect(unknown.requiresSafetyRestore).toBe(false)
    expect(await active()).toMatchObject([{ id: incident.id, status: 'acknowledged', owner_id: '11111111-1111-1111-1111-111111111111' }])
    expect(await active()).toHaveLength(1)
    await run()
    expect(await active()).toEqual([])
  })
  it('does not create production incidents or recovery work for a testbed', async () => {
    const result = await run({ identity: async () => ({ ...await failure(), severity: 'critical' }) }, { ...target, purpose: 'testbed' as 'production' })
    expect(result.status).toBe('unhealthy')
    expect(result.requiresSafetyRestore).toBe(false)
    expect(await active()).toEqual([])
  })
  it('holds unavailable identity without a safety restore', async () => {
    const result = await run({ identity: async () => ({ passed: false, state: 'unobservable', summary: 'Marker missing' }) })
    expect(result.requiresSafetyRestore).toBe(false)
    expect(await active()).toEqual([])
  })
  it('records unavailable linked responses without erasing successful page evidence', async () => {
    fetcher.mockImplementation(async input => {
      if (String(input).includes('/broken')) throw new Error('Fixture timeout')
      return new Response('<html lang="en"><a href="/broken">Details</a></html>', { headers: { 'content-type': 'text/html' } })
    })
    const result = await run()
    expect(result.checks.accessibility.state).toBe('unobservable')
    expect(result.checks.reachability.state).toBe('healthy')
    expect(result.counts.unobservable).toBeGreaterThan(0)
  })
  it('does not follow a redirect outside the checked origin', async () => {
    fetcher.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }))
    const result = await run()
    expect(result.checks.accessibility.state).toBe('unobservable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.requiresSafetyRestore).toBe(false)
  })
  it('leaves a paused alert pending, claims once across workers, and records acceptance without claiming receipt', async () => {
    const result = await run({ accessibility: failure })
    const send = vi.fn().mockResolvedValue({ recipients: 1, messageIds: ['fixture-message'] })
    const input = { incidentIds: result.alertIncidentIds, summary }
    expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ paused: true, accepted: 0 })
    expect(send).not.toHaveBeenCalled()
    vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false')
    await Promise.all([deliverPendingHealthAlerts(input, service, send), deliverPendingHealthAlerts(input, service, send)])
    expect(send).toHaveBeenCalledTimes(1)
    expect((await active())[0].evidence).toMatchObject({ notification: { state: 'accepted', receiptVerified: false } })
    const repeated = await run({ accessibility: failure })
    await deliverPendingHealthAlerts({ ...input, incidentIds: repeated.alertIncidentIds }, service, send)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('never automatically retries an ambiguous provider response', async () => {
    const result = await run({ accessibility: failure })
    vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false')
    const send = vi.fn().mockRejectedValue(new Error('Fixture connection lost after send'))
    const input = { incidentIds: result.alertIncidentIds, summary }
    expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1 })
    await run({ accessibility: failure })
    await deliverPendingHealthAlerts(input, service, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect((await active())[0].evidence).toMatchObject({ notification: { state: 'unconfirmed' } })
  })
  it('retains a rejected sender alert through repeated observations without resending', async () => {
    const result = await run({ accessibility: failure })
    vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false')
    const send = vi.fn().mockRejectedValue(new IncidentAlertDeliveryError('blocked', 'sender_domain_unverified'))
    const input = { incidentIds: result.alertIncidentIds, summary }
    expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1, accepted: 0 })
    await run({ accessibility: failure })
    expect(await deliverPendingHealthAlerts(input, service, send)).toMatchObject({ held: 1, accepted: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect((await active())[0].evidence).toMatchObject({ notification: { state: 'blocked', failureCode: 'sender_domain_unverified' } })
  })
  it('keeps a stale passing health run from resolving a newer incident', async () => {
    const earlier = await run()
    await run({ accessibility: failure })
    const incident = (await active())[0]
    // A late-finishing older pass is newer by completion time, but predates the incident.
    await service.from('siteforge_health_runs').update({ completed_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', earlier.runId)
    await expect(runOnePassSiteForgeRepair({ incidentId: incident.id, actorId: '11111111-1111-1111-1111-111111111111', rationale: 'Fixture repair request', handler: 'resolve_after_verified_recheck' }))
      .rejects.toThrow('completed passing recheck')
    expect(await active()).toHaveLength(1)
  })
  it('does not let an older slow failure recreate an incident after a newer completed pass', async () => {
    let release: () => void = () => undefined
    let observed: () => void = () => undefined
    const wait = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { observed = resolve })
    const older = run({ accessibility: async () => { observed(); await wait; return failure() } })
    await started
    await run()
    release()
    const result = await older
    expect(result.incidentChanges).toEqual([])
    expect(await active()).toEqual([])
  })
  it('reports a failed transaction without a partial healthy completion', async () => {
    const unavailable = new Proxy(service, { get(object, name) {
      if (name === 'rpc') return (name: string, args: { p_status: string }) =>
        args.p_status === 'failed' ? object.rpc(name as 'finalize_siteforge_health_run', args as never) : Promise.resolve({ data: null, error: { message: 'Fixture transaction failure' } })
      return Reflect.get(object, name)
    } })
    await expect(runSiteForgeHealth(target, { trigger: 'restore', service: unavailable, fetch: fetcher, resolve, probes: { ...healthy, accessibility: failure } }))
      .rejects.toThrow('Fixture transaction failure')
    const saved = await service.from('siteforge_health_runs').select('status,evidence').eq('website_id', websiteId).single()
    expect(saved.data).toMatchObject({ status: 'failed', evidence: { error: expect.stringContaining('Fixture transaction failure') } })
    expect(await active()).toMatchObject([{ dedupe_key: 'operation:monitoring' }])
  })
  it('rolls back all incident writes when a later check fails validation', async () => {
    const created = await service.from('siteforge_health_runs').insert({ org_id: orgId,property_id:propertyId,website_id:websiteId,status:'running',trigger_type:'manual' }).select('id').single()
    if (created.error || !created.data) throw created.error
    const result = await service.rpc('finalize_siteforge_health_run',{ p_run_id:created.data.id,p_status:'degraded',p_evidence:{purpose:'production'},p_checks:{
      accessibility:{state:'failed',passed:false,severity:'medium',summary:'First valid insert'},
      runtime:{state:'failed',passed:false,severity:'invalid',summary:'Reject entire transaction'},
    }})
    expect(result.error).toBeTruthy();expect(await active()).toEqual([])
    expect((await service.from('siteforge_health_runs').select('status').eq('id',created.data.id).single()).data?.status).toBe('running')
  })
  it('serializes overlapping failing observations into one acknowledged incident', async () => {
    await run({accessibility:failure});const original=(await active())[0]
    await service.from('siteforge_incidents').update({status:'acknowledged',owner_id:'11111111-1111-1111-1111-111111111111'}).eq('id',original.id)
    await Promise.all([run({accessibility:failure}),run({accessibility:failure}),run({accessibility:failure})])
    expect(await active()).toMatchObject([{id:original.id,status:'acknowledged',owner_id:'11111111-1111-1111-1111-111111111111'}]);expect(await active()).toHaveLength(1)
  })
  it('replays a committed acknowledgement without rewriting checks or incidents', async () => {
    const result=await run({accessibility:failure});const before=await active()
    const replay=await service.rpc('finalize_siteforge_health_run',{p_run_id:result.runId,p_status:'healthy',p_checks:{},p_evidence:{purpose:'production'}})
    expect(replay.error).toBeNull();expect(await active()).toEqual(before)
    expect((await service.from('siteforge_health_runs').select('status').eq('id',result.runId).single()).data?.status).toBe('degraded')
  })
  it('deduplicates execution failures and clears them only after a completed observation', async () => {
    for (let i=0;i<2;i++) {
      const created=await service.from('siteforge_health_runs').insert({org_id:orgId,property_id:propertyId,website_id:websiteId,status:'running',trigger_type:'manual'}).select('id').single()
      if (!created.data) throw created.error
      const saved=await service.rpc('finalize_siteforge_health_run',{p_run_id:created.data.id,p_status:'failed',p_checks:{},p_evidence:{purpose:'production',error:'Fixture execution failure'}})
      expect(saved.error).toBeNull()
    }
    expect(await active()).toHaveLength(1);expect((await active())[0].dedupe_key).toBe('operation:monitoring')
    await run();expect(await active()).toEqual([])
  })
  it('groups repeated restore failures, keeps ownership and ignores an older recovery', async () => {
    const input={websiteId,orgId,propertyId,operation:'restore' as const,failed:true,observedAt:'2026-09-15T21:00:00Z',summary:'Fixture restore failed'}
    const id=await recordOperationalIncident(input,service)
    await service.from('siteforge_incidents').update({status:'acknowledged',owner_id:'11111111-1111-1111-1111-111111111111'}).eq('id',id!)
    expect(await recordOperationalIncident({...input,observedAt:'2026-09-15T21:01:00Z'},service)).toBe(id)
    await recordOperationalIncident({...input,failed:false},service)
    expect(await active()).toMatchObject([{id,status:'acknowledged',owner_id:'11111111-1111-1111-1111-111111111111'}])
    await recordOperationalIncident({...input,failed:false,observedAt:'2026-09-15T21:02:00Z'},service)
    expect(await active()).toEqual([])
  })
  it('records a restore request failure instead of only logging it', async () => {
    const failedQuery: Record<string, unknown> = {}
    for (const method of ['select','eq','in','order','limit']) failedQuery[method]=()=>failedQuery
    failedQuery.maybeSingle=async()=>({data:null,error:{message:'Fixture release unavailable'}})
    const client=new Proxy(service,{get(object,name){
      if(name==='from')return (table:string)=>table==='siteforge_launch_releases'?failedQuery:object.from(table as 'siteforge_health_runs')
      return Reflect.get(object,name)
    }})
    const result=await runSiteForgeHealth(target,{trigger:'manual',service:client,fetch:fetcher,resolve,probes:{...healthy,reachability:async()=>({passed:false,state:'failed',severity:'critical',summary:'Fixture unreachable'})}})
    expect(result.restoreRequest).toMatchObject({state:'failed',reason:expect.stringContaining('Fixture release unavailable')})
    expect((await active()).some(row=>row.dedupe_key==='operation:restore')).toBe(true)
  })
  it('does not let an older execution failure reopen an incident after a newer completed run', async () => {
    const older=await service.from('siteforge_health_runs').insert({org_id:orgId,property_id:propertyId,website_id:websiteId,status:'running',trigger_type:'manual'}).select('id').single()
    if(!older.data)throw older.error
    await run()
    const final=await service.rpc('finalize_siteforge_health_run',{p_run_id:older.data.id,p_status:'failed',p_checks:{},p_evidence:{purpose:'production',error:'Delayed old failure'}})
    expect(final.error).toBeNull();expect(await active()).toEqual([])
  })
  it('lists the exact active count and excludes resolved history from the active page', async () => {
    await run({ accessibility: failure })
    const result = await listSiteForgeIncidents(websiteId)
    expect(result.activeIncidentCount).toBe(1)
    expect(result.incidents).toHaveLength(1)
    expect(result.healthRuns).toHaveLength(1)
    await run()
    expect((await listSiteForgeIncidents(websiteId)).activeIncidentCount).toBe(0)
  })
})
