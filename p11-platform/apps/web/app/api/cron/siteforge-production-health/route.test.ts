import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ createService: vi.fn(), start: vi.fn(), finish: vi.fn(), confirm: vi.fn(), health: vi.fn(), alerts: vi.fn(), send: vi.fn(), stale: vi.fn(), restores: vi.fn(), sweep: vi.fn(), operation: vi.fn(), rows: [] as Record<string, unknown>[] }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: mocks.createService }))
vi.mock('@/utils/services/cron-job-runs', () => ({ startCronJobRun: mocks.start, finishCronJobRun: mocks.finish, confirmCronJobRun: mocks.confirm }))
vi.mock('@/utils/siteforge/production-health', async importOriginal => ({ ...await importOriginal<object>(), runSiteForgeHealth: mocks.health }))
vi.mock('@/utils/siteforge/health-alerts', () => ({ deliverPendingHealthAlerts: mocks.alerts }))
vi.mock('@/utils/siteforge/incident-alerts', () => ({ sendSiteForgeIncidentAlert: mocks.send }))
vi.mock('@/utils/siteforge/stale-job-reconciler', () => ({ reconcileStaleSiteForgeJobs: mocks.stale }))
vi.mock('@/utils/siteforge/restore-drill-runner', () => ({ processSiteForgeRestoreDrills: mocks.restores }))
vi.mock('@/utils/siteforge/monitoring-sweep', () => ({ visitMonitoringSweep: mocks.sweep }))
vi.mock('@/utils/siteforge/operational-incidents', () => ({ recordOperationalIncident: mocks.operation }))
import { GET } from './route'

function request(auth = true) {
  return new Request('http://localhost/api/cron/siteforge-production-health', { headers: auth ? { authorization: 'Bearer fixture-secret' } : {} }) as NextRequest
}
function service(rows: Record<string, Record<string, unknown>[]>) {
  mocks.rows = rows.property_websites || []
  return { from: (table: string) => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'not', 'order', 'limit', 'in', 'eq']) query[method] = () => query
    query.single = async () => ({ data: { status: 'success', completed_at: new Date().toISOString() }, error: null })
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows[table] || [], error: null }))
    return query
  } }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'fixture-secret')
  mocks.start.mockResolvedValue({ id: 'run' })
  mocks.finish.mockResolvedValue(true)
  mocks.confirm.mockResolvedValue(undefined)
  mocks.stale.mockResolvedValue({ recovered: 0 })
  mocks.restores.mockResolvedValue({ failed: 0, awaitingOperator: 0, results: [] })
  mocks.alerts.mockResolvedValue({ accepted: 0, held: 0, skipped: 0, paused: true })
  mocks.sweep.mockImplementation(async input => { await input.visit(mocks.rows); return { claimed: true, coverageComplete: true, processed: mocks.rows.length, nextCursor: null } })
})
afterEach(() => vi.unstubAllEnvs())
describe('SiteForge production health cron route', () => {
  it('reports a deferred sweep as partial without inventing complete coverage', async () => {
    mocks.createService.mockReturnValue(service({}));mocks.sweep.mockResolvedValue({claimed:true,coverageComplete:false,processed:0,nextCursor:'saved-position'})
    const response=await GET(request());expect(await response.json()).toMatchObject({success:false,coverage:{coverageComplete:false}})
    expect(mocks.confirm).toHaveBeenCalledWith({id:'run'},expect.objectContaining({status:'partial'}))
  })
  it('starts no recovery work when another scheduled sweep owns the lease', async () => {
    mocks.createService.mockReturnValue(service({}));mocks.sweep.mockResolvedValue({claimed:false,coverageComplete:false,processed:0,nextCursor:null})
    expect((await GET(request())).status).toBe(200);expect(mocks.stale).not.toHaveBeenCalled();expect(mocks.restores).not.toHaveBeenCalled()
  })
  it('does not report success if saving the cron summary cannot be confirmed', async () => {
    mocks.createService.mockReturnValue(service({}))
    mocks.confirm.mockRejectedValueOnce(new Error('Scheduled result could not be saved'))
    mocks.sweep.mockResolvedValue({claimed:true,coverageComplete:true,processed:0,nextCursor:null})
    expect((await GET(request())).status).toBe(500)
  })

  it('rejects requests without cron authentication', async () => {
    expect((await GET(request(false))).status).toBe(401)
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('starts no monitoring or recovery work without a durable run record', async () => {
    mocks.start.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(503)
    expect(mocks.stale).not.toHaveBeenCalled()
    expect(mocks.restores).not.toHaveBeenCalled()
    expect(mocks.health).not.toHaveBeenCalled()
  })
  it('reports incomplete evidence as partial and classifies testbeds without emailing production alerts', async () => {
    mocks.createService.mockReturnValue(service({ property_websites: [{ id: 'website', org_id: 'org', property_id: 'property', production_url: 'https://fixture.test', production_target_id: 'target', pages_generated: [] }],
      siteforge_wordpress_targets: [{ id: 'target', website_id: 'website', target_type: 'production', is_active: true, site_url: 'https://fixture.test', metadata: { lifecycleOwnerId: 'owner', lifecycleRunId: 'run' } }] }))
    mocks.health.mockResolvedValue({ status: 'degraded', purpose: 'testbed', counts: { unobservable: 2 }, alertIncidentIds: [] })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: false, degraded: 1, unavailableChecks: 2 })
    expect(mocks.health).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'testbed' }), expect.anything())
    expect(mocks.confirm).toHaveBeenCalledWith({ id: 'run' }, expect.objectContaining({ status: 'partial' }))
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('keeps each alert summary scoped to its own website across organizations',async()=>{
    mocks.createService.mockReturnValue(service({property_websites:[
      {id:'a',org_id:'org-a',property_id:'pa',production_url:'https://a.test'},
      {id:'b',org_id:'org-b',property_id:'pb',production_url:'https://b.test'},
    ]}))
    mocks.health.mockImplementation(async target=>({status:'unhealthy',purpose:'production',counts:{unobservable:0},alertIncidentIds:['incident-'+target.websiteId]}))
    expect((await GET(request())).status).toBe(200)
    expect(mocks.alerts).toHaveBeenCalledTimes(2)
    for(const [input] of mocks.alerts.mock.calls)expect(input.summary).toMatchObject({processed:1,unhealthy:1,staleJobsRecovered:null})
  })
  it('does not process the global recovery queue during a single-site check',async()=>{
    mocks.createService.mockReturnValue(service({}))
    await GET(new Request('http://localhost/api/cron/siteforge-production-health?websiteId=11111111-1111-1111-1111-111111111111',{headers:{authorization:'Bearer fixture-secret'}}) as NextRequest)
    expect(mocks.stale).not.toHaveBeenCalled();expect(mocks.restores).not.toHaveBeenCalled()
  })

  it('keeps checking other websites when alert delivery is held', async () => {
    mocks.createService.mockReturnValue(service({property_websites:[
      {id:'a',org_id:'org-a',property_id:'pa',production_url:'https://a.test'},
      {id:'b',org_id:'org-b',property_id:'pb',production_url:'https://b.test'},
    ]}))
    mocks.health.mockImplementation(async target => ({status:'degraded',purpose:'production',
      counts:{unobservable:0},alertIncidentIds:['incident-'+target.websiteId]}))
    mocks.alerts.mockResolvedValue({accepted:0,held:1,skipped:0,paused:false})
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({success:false,processed:2,alerts:{held:2}})
    expect(mocks.health).toHaveBeenCalledTimes(2)
    expect(mocks.confirm).toHaveBeenCalledWith({id:'run'},expect.objectContaining({status:'partial'}))
  })

})
