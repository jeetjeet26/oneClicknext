import {describe,expect,it} from 'vitest'
import {confirmOAuthGrant} from './integration-oauth-grant'
const google='https://www.googleapis.com/auth/calendar'
const token={access_token:'access',refresh_token:'refresh',expires_in:3600,token_type:'Bearer',scope:google}
describe('confirmed OAuth grants',()=>{
 it.each([undefined,null,[],{}, {access_token:{}}, {...token,access_token:'bad token'}, {...token,refresh_token:22}, {...token,refresh_token:''}, {...token,expires_in:'3600'}, {...token,expires_in:NaN}, {...token,expires_in:Infinity}, {...token,expires_in:0}, {...token,expires_in:40000000}, {...token,token_type:'Basic'}, {...token,token_type:undefined}])('rejects malformed credentials %#',value=>{expect(()=>confirmOAuthGrant('google',['calendar'],value)).toThrow('invalid_token_response')})
 it.each([undefined,null,'',[],42])('never fabricates missing Google grants %#',scope=>{expect(()=>confirmOAuthGrant('google',['calendar'],{...token,scope},[google])).toThrow('permissions_unconfirmed')})
 it.each([google+'.readonly',google+'.events',google+'.malicious','https://www.googleapis.com/auth/CALENDAR'])('does not substitute a similarly named or partial permission %s',scope=>{expect(()=>confirmOAuthGrant('google',['calendar'],{...token,scope})).toThrow('permissions_incomplete')})
 it('preserves actual scopes and deduplicates without inventing requested permissions',()=>{expect(confirmOAuthGrant('google',['calendar'],{...token,scope:`${google} openid ${google}`})).toMatchObject({scopes:[google,'openid'],scopeEvidence:'provider_response'})})
 it('rejects partial combined consent before either integration is saved',()=>{expect(()=>confirmOAuthGrant('google',['calendar','email'],token)).toThrow('permissions_incomplete')})
 it('accepts Gmail modify as covering its read/send/modify operations',()=>{expect(confirmOAuthGrant('google',['email'],{...token,scope:'https://www.googleapis.com/auth/gmail.modify'}).scopes).toHaveLength(1)})
 it('does not authorize Gmail modification from read/send-only scopes',()=>{expect(()=>confirmOAuthGrant('google',['email'],{...token,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'})).toThrow('permissions_incomplete')})
 it('accepts a Graph-qualified permission response',()=>{expect(confirmOAuthGrant('microsoft',['calendar'],{...token,scope:'https://graph.microsoft.com/Calendars.ReadWrite User.Read'}).scopeEvidence).toBe('provider_response')})
 it('accepts the documented encoded Graph scope representation',()=>{expect(confirmOAuthGrant('microsoft',['email'],{...token,scope:'https%3A%2F%2Fgraph.microsoft.com%2Fmail.read Mail.Send User.Read'}).scopeEvidence).toBe('provider_response')})
 it('holds missing Microsoft scope when the original request is not signed',()=>{expect(()=>confirmOAuthGrant('microsoft',['calendar'],{...token,scope:undefined})).toThrow('permissions_unconfirmed')})
 it('uses the exact signed original request only for Microsoft omitted scope',()=>{expect(confirmOAuthGrant('microsoft',['calendar'],{...token,scope:undefined},['Calendars.ReadWrite','User.Read'])).toMatchObject({scopes:['Calendars.ReadWrite','User.Read'],scopeEvidence:'microsoft_request_contract'})})
 it.each(['',null,'Mail.Read User.Read'])('never replaces explicit partial Microsoft response %#',scope=>{expect(()=>confirmOAuthGrant('microsoft',['calendar'],{...token,scope},['Calendars.ReadWrite','User.Read'])).toThrow()})
 it('does not treat another API scope as Graph permission',()=>{expect(()=>confirmOAuthGrant('microsoft',['calendar'],{...token,scope:'https://evil.invalid/Calendars.ReadWrite User.Read'})).toThrow('permissions_incomplete')})
 it('requires every selected Microsoft capability',()=>{expect(()=>confirmOAuthGrant('microsoft',['calendar','email'],{...token,scope:'Calendars.ReadWrite User.Read Mail.Read'})).toThrow('permissions_incomplete')})
})
