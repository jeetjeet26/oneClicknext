import {beforeEach,expect,it,vi} from 'vitest'
const d=vi.hoisted(()=>({from:vi.fn(),read:vi.fn(),eq:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from})}))
import {readIntegrationInviteLink,hashInviteToken} from './integration-auth-invites'
const token='fixture-token-with-enough-entropy'
beforeEach(()=>{vi.resetAllMocks();d.from.mockReturnValue({select:()=>({eq:d.eq})});d.eq.mockReturnValue({maybeSingle:d.read});d.read.mockResolvedValue({data:{provider:'google',requested_capabilities:['calendar'],expires_at:'2099-01-01',consumed_at:null,revoked_at:null,properties:{name:'Fixture property'}}})})
it('returns only property, provider, requested access and current status for the matching token',async()=>{expect(await readIntegrationInviteLink(token)).toEqual({provider:'google',capabilities:['calendar'],propertyName:'Fixture property',expiresAt:'2099-01-01',state:'pending'});expect(d.eq).toHaveBeenCalledWith('token_hash',hashInviteToken(token))})
it.each(['','short','bad token with whitespace'])('rejects malformed public tokens without a database read',async token=>{expect(await readIntegrationInviteLink(token)).toBeNull();expect(d.from).not.toHaveBeenCalled()})
it('distinguishes unavailable storage from an invalid link',async()=>{d.read.mockResolvedValue({error:{message:'PRIVATE DETAILS'}});await expect(readIntegrationInviteLink(token)).rejects.toThrow('status is unavailable')})
it('returns invalid when the token has no saved link',async()=>{d.read.mockResolvedValue({data:null});expect(await readIntegrationInviteLink(token)).toBeNull()})
it.each([{consumed_at:'2026-01-01',state:'used'},{revoked_at:'2026-01-01',state:'revoked'},{expires_at:'2020-01-01',state:'expired'}])('reports saved terminal status $state',async fixture=>{d.read.mockResolvedValue({data:{provider:'google',requested_capabilities:['email'],expires_at:'2099-01-01',...fixture}});expect((await readIntegrationInviteLink(token))?.state).toBe(fixture.state)})
