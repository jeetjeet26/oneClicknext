/** Normalize a provider or property-local clock without guessing a DST gap/fold. */
export function calendarDateTimeInstant(value:unknown,zone?:string|null):string|null {
 if(typeof value!=='string')return null
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value)
 if(!match)return null
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number)
 const ms=Number((match[7]||'').padEnd(3,'0').slice(0,3)),wall=Date.UTC(year,month-1,day,hour,minute,second,ms),date=new Date(wall)
 if(year<1000||month<1||month>12||day<1||hour>23||minute>59||second>59||date.getUTCDate()!==day)return null
 if(match[8]) {
  const offset=match[8]
  if(offset==='Z')return date.toISOString()
  const hours=Number(offset.slice(1,3)),minutes=Number(offset.slice(4,6));if(hours>23||minutes>59)return null
  return new Date(wall-(offset[0]==='-'?-1:1)*(hours*60+minutes)*60000).toISOString()
 }
 if(!zone)return null
 try {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})
  const parts=(at:number)=>Object.fromEntries(formatter.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))
  const candidates=new Set<number>()
  for(const delta of [-2,0,2]) {
   const probe=wall+delta*86400000,local=parts(probe)
   const offset=Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute,local.second)-Math.floor(probe/1000)*1000
   const candidate=wall-offset,p=parts(candidate)
   if(p.year===year&&p.month===month&&p.day===day&&p.hour===hour&&p.minute===minute&&p.second===second)candidates.add(candidate)
  }
  return candidates.size===1?new Date([...candidates][0]).toISOString():null
 }catch{return null}
}


/** A date label is a calendar day, never an instant in the server timezone. */
export function validCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && calendarDateTimeInstant(`${value}T00:00:00Z`) !== null
}

export function addCalendarDays(value: string, days: number): string {
  if (!validCalendarDay(value) || !Number.isInteger(days)) throw new Error('Invalid calendar day')
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

export function calendarToday(timezone: string, now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Exclusive day end accounts for 23/25-hour daylight-saving days. */
export function calendarDayRange(first: string, last: string, timezone: string): {start: Date; end: Date} {
  if (!validCalendarDay(first) || !validCalendarDay(last) || first > last) throw new Error('Invalid calendar day range')
  const start = calendarDateTimeInstant(`${first}T00:00:00`, timezone)
  const end = calendarDateTimeInstant(`${addCalendarDays(last, 1)}T00:00:00`, timezone)
  if (!start || !end) throw new Error('Calendar day has no unambiguous timezone boundary')
  return {start: new Date(start), end: new Date(end)}
}
