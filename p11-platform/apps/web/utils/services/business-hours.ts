import {normalizeTimezoneToIana} from './timezone'

type Hours = {start:string;end:string;enabled?:boolean}
const aliases:Record<string,string>={monday:'mon',tuesday:'tue',wednesday:'wed',thursday:'thu',friday:'fri',saturday:'sat',sunday:'sun'}
const clock=/^([01]\d|2[0-3]):[0-5]\d$/

/** Unknown schedules stay unknown. An explicit closed day remains false. */
export function businessHoursStatus(value:unknown,timezone:unknown,now=new Date()):boolean|null {
 const zone=normalizeTimezoneToIana(typeof timezone==='string'?timezone:null)
 if(!zone||!value||typeof value!=='object'||Array.isArray(value)||!Number.isFinite(now.getTime()))return null
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
 const part=(name:string)=>parts.find(piece=>piece.type===name)?.value
 const day=part('weekday')?.toLowerCase();if(!day)return null
 const schedule=value as Record<string,unknown>
 const hours=Object.hasOwn(schedule,day)?schedule[day]:schedule[aliases[day]]
 if(hours===null)return false
 if(!hours||typeof hours!=='object'||Array.isArray(hours))return null
 const range=hours as Hours
 if(range.enabled===false)return false
 if(typeof range.start!=='string'||typeof range.end!=='string'||!clock.test(range.start)||!clock.test(range.end)||range.start>=range.end)return null
 const time=`${part('hour')}:${part('minute')}`
 return time>=range.start&&time<range.end
}
