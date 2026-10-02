import {expect,it} from 'vitest'
import {businessHoursStatus} from './business-hours'
const monday=new Date('2026-09-14T14:00:00Z')
it('reads legacy short weekday keys',()=>expect(businessHoursStatus({mon:{start:'09:00',end:'17:00'}},'America/New_York',monday)).toBe(true))
it('reads saved long weekday keys',()=>expect(businessHoursStatus({monday:{start:'09:00',end:'17:00'}},'America/New_York',monday)).toBe(true))
it('preserves an explicit closed day over a legacy alias',()=>expect(businessHoursStatus({monday:null,mon:{start:'09:00',end:'17:00'}},'America/New_York',monday)).toBe(false))
it('does not substitute a timezone',()=>expect(businessHoursStatus({mon:{start:'09:00',end:'17:00'}},null,monday)).toBeNull())
it.each([null,{},[],{mon:{start:'not a time',end:'17:00'}},{mon:{start:'18:00',end:'09:00'}}])('retains uncertainty for malformed hours (%j)',hours=>expect(businessHoursStatus(hours,'UTC',monday)).toBeNull())
it('respects explicit disabled provider-style hours',()=>expect(businessHoursStatus({mon:{enabled:false,start:'09:00',end:'17:00'}},'UTC',monday)).toBe(false))
it('closes at the exact end of the advertised interval',()=>expect(businessHoursStatus({mon:{start:'09:00',end:'14:00'}},'UTC',monday)).toBe(false))
it('uses midnight as 00:00',()=>expect(businessHoursStatus({mon:{start:'00:00',end:'01:00'}},'UTC',new Date('2026-09-14T00:15:00Z'))).toBe(true))
