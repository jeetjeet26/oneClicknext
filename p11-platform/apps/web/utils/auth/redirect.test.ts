import{it,expect}from'vitest'
import{accountAuthRedirect,localAuthRedirect}from'./redirect'
it('preserves exact invitation review for new and existing accounts',()=>{expect(accountAuthRedirect('/join/team',false)).toBe('/join/team');expect(accountAuthRedirect('/join/team',true)).toBe('/join/team');expect(accountAuthRedirect('/dashboard/team',false)).toBe('/onboarding')})
it.each(['//outside.invalid','/\\outside.invalid','https://outside.invalid','/\n/outside.invalid'])('rejects outside redirect %s',v=>expect(localAuthRedirect(v)).toBe('/dashboard'))

it('keeps private account security available without organization membership',()=>{expect(accountAuthRedirect('/account/security',false)).toBe('/account/security');expect(accountAuthRedirect('/account/security/other',false)).toBe('/onboarding')})
