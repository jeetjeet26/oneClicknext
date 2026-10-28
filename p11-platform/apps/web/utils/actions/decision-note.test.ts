import { describe, expect, it } from 'vitest'
import { decisionNote, hasDecisionNote, NO_DECISION_NOTE } from './decision-note'
import { configurationDecision, competitorDecision } from '@/utils/marketvision/decision-contracts'
import { HandoffDecision } from '@/utils/marketvision/handoff-contracts'
import { accountCommand } from '@/utils/account-settings/contracts'
import { responseWriteSchema } from '@/utils/reviewflow/response-contracts'
import { joinCommand, teamCommand } from '@/utils/team/contracts'
import { readinessCommand } from '@/utils/readiness/contracts'

const id = '11111111-1111-4111-8111-111111111111', hash = 'a'.repeat(64)
describe('Routine actions retain history without demanding an explanation', () => {
 const cases = [
  [configurationDecision, {requestId:id, propertyId:id, expectedVersion:0, values:{is_enabled:false,scrape_frequency:'weekly',radius_miles:4.5,max_competitors:20,auto_add:false}}],
  [competitorDecision, {requestId:id,propertyId:id,action:'archive',competitorId:id,expectedVersion:1}],
  [accountCommand, {requestId:id,orgId:id,operation:'save_preferences',section:'personal',sourceHash:hash,confirmed:true,theme:'dark',accentColor:'blue'}],
  [joinCommand, {requestId:id,operation:'accept',invitationHash:hash,confirmed:true}],
  [teamCommand, {requestId:id,orgId:id,operation:'create_invitation',confirmed:true,email:'person@example.com',role:'viewer',expiresInDays:7}],
  [HandoffDecision, {requestId:id,propertyId:id,handoffId:id,expectedVersion:1,draftHash:hash,decision:'approve'}],
  [responseWriteSchema, {requestId:id,propertyId:id,action:'approve',responseId:id,expectedVersion:1,sourceVersion:1,contextHash:hash,contentHash:hash}],
 ] as const
 for (const [i, [schema, input]] of cases.entries()) {
  it(`accepts omitted and blank notes for routine action ${i + 1}`, () => {
   for (const note of [undefined, '', '   ']) expect(schema.parse({...input, reason:note})).toMatchObject({...input,reason:NO_DECISION_NOTE})
   expect(schema.parse({...input,reason:'Reviewed with the property team'})).toHaveProperty('reason','Reviewed with the property team')
  })
 }
 it('does not relax versions, permissions acknowledgements or actual form data', () => {
  expect(configurationDecision.safeParse({...cases[0][1],expectedVersion:-1}).success).toBe(false)
  expect(teamCommand.safeParse({...cases[4][1],confirmed:false}).success).toBe(false)
 })
 it('requires rejection feedback and does not accept the absence marker as feedback', () => {
  for(const reason of [undefined,'',NO_DECISION_NOTE]) expect(HandoffDecision.safeParse({...cases[5][1],decision:'reject',reason}).success).toBe(false)
  expect(HandoffDecision.safeParse({...cases[5][1],decision:'reject',reason:'The objective needs a specific audience.'}).success).toBe(true)
 })
 it('requires reasons for access changes and readiness overrides', () => {
  const access={requestId:id,orgId:id,operation:'change_role',memberId:id,memberHash:hash,rosterHash:hash,role:'admin',confirmed:true}
  expect(teamCommand.safeParse(access).success).toBe(false)
  expect(teamCommand.safeParse({...access,reason:'Appointed as property administrator'}).success).toBe(true)
  const ready={requestId:id,propertyId:id,operation:'approve',snapshotId:id,snapshotHash:hash,sourceHash:hash,confirmed:true}
  expect(readinessCommand.safeParse(ready).success).toBe(true)
  expect(readinessCommand.safeParse({...ready,allowManagerOverride:true}).success).toBe(false)
 })
 it('keeps optional notes bounded and excludes missing-note markers from history', () => {
  expect(decisionNote().safeParse('x'.repeat(2001)).success).toBe(false)
  expect(decisionNote().safeParse('bad\u0000note').success).toBe(false)
  expect(hasDecisionNote(NO_DECISION_NOTE)).toBe(false)
  expect(hasDecisionNote('')).toBe(false)
  expect(hasDecisionNote('Discussed with the team')).toBe(true)
 })
})
