import {expect,it} from 'vitest'
import {integrationPermissionState,refreshedScopeEvidence} from './integration-permissions'
it('requires grant evidence, rather than a list of originally requested permissions',()=>{expect(integrationPermissionState('google','calendar',['https://www.googleapis.com/auth/calendar'],{})).toBe('permissions_unconfirmed')})
it('accepts the documented encoded Graph permission format',()=>{expect(integrationPermissionState('microsoft','email',['User.Read','https%3A%2F%2Fgraph.microsoft.com%2FMail.Read','Mail.Send'],{scopeEvidence:'provider_response'})).toBe('confirmed')})
it.each(['calendar','email'] as const)('rejects a read-only %s grant',capability=>{expect(integrationPermissionState('microsoft',capability,['User.Read','Mail.Read','Calendars.Read'],{scopeEvidence:'refresh_inherited'})).toBe('permissions_incomplete')})
it.each([null,[],['%ZZ'],[null],['User.Read other']])('holds invalid scopes %j',scopes=>{expect(integrationPermissionState('microsoft','email',scopes,{scopeEvidence:'provider_response'})).toBe('permissions_unconfirmed')})
it('distinguishes omitted scope from malformed explicit scope',()=>{expect(refreshedScopeEvidence({})).toEqual({});expect(refreshedScopeEvidence({scope:null})).toEqual({scope:null});expect(refreshedScopeEvidence({scope:{private:'data'}})).toEqual({scope:null});expect(refreshedScopeEvidence({scope:'x'.repeat(16385)})).toEqual({scope:null})})

it('rejects malformed extra Graph permissions even alongside required ones',()=>{expect(integrationPermissionState('microsoft','calendar',['User.Read','Calendars.ReadWrite','bad%20scope'],{scopeEvidence:'provider_response'})).toBe('permissions_unconfirmed')})
