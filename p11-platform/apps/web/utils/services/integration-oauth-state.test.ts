import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSignedIntegrationOAuthState,
  verifySignedIntegrationOAuthState,
} from './integration-oauth-state'

describe('integration OAuth state', () => {
  beforeEach(() => {
    vi.stubEnv('INTEGRATION_OAUTH_STATE_SECRET', 'test-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round trips a dashboard state payload', () => {
    const state = createSignedIntegrationOAuthState({
      propertyId: 'property-1',
      provider: 'microsoft',
      capabilities: ['calendar', 'email'],
      authSource: 'dashboard',
      profileId: 'profile-1',
      timestamp: 1000,
    })

    expect(verifySignedIntegrationOAuthState(state, 1000)).toEqual({
      propertyId: 'property-1',
      provider: 'microsoft',
      capabilities: ['calendar', 'email'],
      authSource: 'dashboard',
      profileId: 'profile-1',
      timestamp: 1000,
      inviteId: undefined,
      tokenHash: undefined,
      returnPath: undefined,
      requestId: undefined,
      redirectUri: undefined,
      requestedScopes: ['openid','email','profile','offline_access','User.Read','Calendars.ReadWrite','MailboxSettings.Read','Mail.Send','Mail.Read'],
    })
  })

  it('rejects tampered state', () => {
    const state = createSignedIntegrationOAuthState({
      propertyId: 'property-1',
      provider: 'google',
      capabilities: ['email'],
      authSource: 'external_invite',
      inviteId: 'invite-1',
      tokenHash: 'hash-1',
      timestamp: 1000,
    })

    expect(() => verifySignedIntegrationOAuthState(`${state}x`, 1000)).toThrow(
      'Invalid OAuth state signature'
    )
  })
})

it('signs the server-selected scopes and rejects scope tampering',()=>{
 vi.stubEnv('INTEGRATION_OAUTH_STATE_SECRET','test-secret')
 try {
 const state=createSignedIntegrationOAuthState({propertyId:'property',provider:'google',capabilities:['calendar'],authSource:'dashboard',profileId:'actor',timestamp:1000,requestedScopes:['fake']})
 expect(verifySignedIntegrationOAuthState(state,1000).requestedScopes).toContain('https://www.googleapis.com/auth/calendar')
 expect(verifySignedIntegrationOAuthState(state,1000).requestedScopes).not.toContain('fake')
 const [payload,signature]=state.split('.');const changed=JSON.parse(Buffer.from(payload,'base64url').toString());changed.requestedScopes=['fake'];expect(()=>verifySignedIntegrationOAuthState(`${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`,1000)).toThrow('signature')
 } finally {vi.unstubAllEnvs()}
})

it('only permits expired signatures for outcome closure and still bounds their age',()=>{
 vi.stubEnv('INTEGRATION_OAUTH_STATE_SECRET','test-secret')
 try {
 const now=Date.now(),s=createSignedIntegrationOAuthState({propertyId:'property',provider:'google',capabilities:['calendar'],authSource:'dashboard',timestamp:now-16*60000})
 expect(()=>verifySignedIntegrationOAuthState(s,now)).toThrow('expired')
 expect(verifySignedIntegrationOAuthState(s,now,{outcomeOnly:true}).propertyId).toBe('property')
 expect(()=>verifySignedIntegrationOAuthState(s+'x',now,{outcomeOnly:true})).toThrow('signature')
 expect(()=>verifySignedIntegrationOAuthState(s,now+24*3600000,{outcomeOnly:true})).toThrow('expired')
 const future=createSignedIntegrationOAuthState({propertyId:'property',provider:'google',capabilities:['calendar'],authSource:'dashboard',timestamp:now+120000})
 expect(()=>verifySignedIntegrationOAuthState(future,now,{outcomeOnly:true})).toThrow('invalid')
 }finally{vi.unstubAllEnvs()}
})
