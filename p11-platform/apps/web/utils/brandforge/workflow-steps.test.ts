import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), property: true }))
vi.mock('./operations', () => ({ brandRpc: mocks.rpc }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: mocks.property ? { id: 'property' } : null, error: null }) }) }) }) }) }) }))
import { persistBrandForgeWorkflowContract, failBrandForgeWorkflow } from './workflow-steps'
import { normalizeBrandForgeContract } from './normalize'
import type { BrandForgeWorkflowInput, CompetitivePositioningSnapshot } from './contracts'
const workflow = { brandAssetId: '33333333-3333-4333-8333-333333333333', propertyId: '44444444-4444-4444-8444-444444444444', orgId: '22222222-2222-4222-8222-222222222222', requestedBy: '11111111-1111-4111-8111-111111111111', operationId: '55555555-5555-4555-8555-555555555555', operationToken: '66666666-6666-4666-8666-666666666666', mode: 'generated', vertical: 'multifamily_rental', creativeBrief: { brandName: 'Test', vision: '', targetAudience: '', brandVoice: '', personality: [], visualPreferences: [] } } as BrandForgeWorkflowInput
const snapshot = {schemaVersion:'1.0',sourceHash:'source',causalHash:'causal',generatedAt:'2026-09-16T00:00:00Z',evidence:[]} as unknown as CompetitivePositioningSnapshot
const contract = normalizeBrandForgeContract({identity:{name:'Test'}},{origin:'generated',approvalStatus:'approved'})
const execute = (input=workflow) => persistBrandForgeWorkflowContract({workflow:input,snapshot,contract,generation:'deterministic'})
beforeEach(()=>{vi.clearAllMocks();mocks.property=true;mocks.rpc.mockResolvedValue({state:'applied'})})
it('persists a generated proposal for human review with no inherited model approval',async()=>{
 await execute();const args=mocks.rpc.mock.calls[0][1];expect(args).toMatchObject({p_request_id:workflow.operationId,p_claim_token:workflow.operationToken,p_updates:{approval_status:'reviewing',approved_by:null,approved_at:null,current_step:1,section_1_introduction:null,section_12_implementation:null}})
 const proposed=Object.values(args.p_updates.proposed_sections) as Array<{_meta:{approval:unknown}}>;expect(proposed).toHaveLength(12);for(const section of proposed)expect(section._meta.approval).toEqual({status:'reviewing'})
 expect(args.p_result).toMatchObject({generation:'deterministic',readyForReview:true})
})
it('refuses legacy runs with no saved operation identity',async()=>{await expect(execute({...workflow,operationId:undefined})).rejects.toThrow('saved request');expect(mocks.rpc).not.toHaveBeenCalled()})
it('rechecks the property tenant at background completion',async()=>{mocks.property=false;await expect(execute()).rejects.toThrow('tenant context');expect(mocks.rpc).not.toHaveBeenCalled()})
it('does not report a stopped or stale workflow as successful',async()=>{mocks.rpc.mockResolvedValue({state:'cancelled'});await expect(execute()).rejects.toThrow('no longer matches')})
it('marks only the matching request failed and never overwrites the brand with failure details',async()=>{await failBrandForgeWorkflow(workflow,new Error('private provider detail'));expect(mocks.rpc).toHaveBeenCalledWith('finish_brand_operation',{p_request_id:workflow.operationId,p_claim_token:workflow.operationToken,p_updates:{},p_result:{},p_error:'generation_failed'})})
