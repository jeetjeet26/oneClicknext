import {expect,it} from 'vitest'
import {activityActorLabel} from './presentation'
const event={actor_id:'actor',action:'integration.authorization.failed',request:{authorizer:'external_account'}}
it('distinguishes external account outcomes from their sponsoring operator',()=>{expect(activityActorLabel(event,'actor')).toBe('External account · invitation sponsored by you')})
it('attributes automated expiry to the system, retaining the initiator',()=>{expect(activityActorLabel({...event,request:{...event.request,decisionSource:'expiry_sweep'}},'actor')).toBe('System cleanup · request initiated by you')})
it('does not misattribute automatic invalidation to an external account',()=>{expect(activityActorLabel({...event,request:{...event.request,decisionSource:'request_validation'}},'actor')).toBe('System check · external authorization request')})
it('keeps ordinary confirmed operator actions attributed to their actor',()=>{expect(activityActorLabel({...event,action:'calendar.disconnected',request:{}},'different')).toBe('Team member')})

it('names intake system work separately from its requester',()=>{expect(activityActorLabel({actor_id:null,service_principal:'reviewflow.intake',action:'review.intake.previewed',request:{}},'operator')).toBe('Review import service')})
