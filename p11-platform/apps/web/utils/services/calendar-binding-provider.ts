import type {CalendarConfig, RemoteCalendarEvent} from './google-calendar'
import {renewCalendarCredentials} from './calendar-credentials'
import {calendarDateTimeInstant} from './calendar-time'
export type CalendarBindingCandidate = RemoteCalendarEvent & {title:string}
type Cursor = {key:'pageToken'|'$skiptoken'|'$skip';value:string}
function endpoint(c:CalendarConfig) {
 return c.provider==='microsoft' ? `https://graph.microsoft.com/v1.0/me/${c.calendar_id==='primary'?'calendar':`calendars/${encodeURIComponent(c.calendar_id)}`}/events` : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_id)}/events`
}
async function read(c:CalendarConfig,url:URL,force=false):Promise<Record<string,unknown>|null> {
 const {accessToken}=await renewCalendarCredentials(c,force)
 const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${accessToken}`,...(c.provider==='microsoft'?{Prefer:'outlook.timezone="UTC"'}:{})},redirect:'error'})
 if(response.status===401&&!force)return read(c,url,true)
 if(response.status===404||response.status===410)return null
 if(!response.ok)throw new Error('Calendar events are unavailable. Try again after checking the connection.')
 const body=await response.json() as unknown
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Calendar response could not be verified.')
 return body as Record<string,unknown>
}
function event(value:unknown,microsoft:boolean):CalendarBindingCandidate|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const raw=value as Record<string,unknown>,start=raw.start as Record<string,unknown>|undefined,end=raw.end as Record<string,unknown>|undefined
 const id=raw.id,title=microsoft?raw.subject:raw.summary
 if(typeof id!=='string'||!id||id.length>1024||/\s/.test(id))return null
 const startDateTime=calendarDateTimeInstant(start?.dateTime,typeof start?.timeZone==='string'?start.timeZone:undefined),endDateTime=calendarDateTimeInstant(end?.dateTime,typeof end?.timeZone==='string'?end.timeZone:undefined)
 if(!startDateTime||!endDateTime)return null
 return {id,title:typeof title==='string'?title.slice(0,160):'Calendar event',status:microsoft?raw.isCancelled===true?'cancelled':'confirmed':typeof raw.status==='string'?raw.status:null,startDateTime,endDateTime}
}
export async function readCalendarBindingEvent(c:CalendarConfig,id:string):Promise<RemoteCalendarEvent|null> {
 const raw=await read(c,new URL(`${endpoint(c)}/${encodeURIComponent(id)}`));const found=event(raw,c.provider==='microsoft')
 if(!found)return null
 if(found.id!==id)throw new Error('Calendar event identity changed. Reload the matching events.')
 return {id:found.id,status:found.status,startDateTime:found.startDateTime,endDateTime:found.endDateTime}
}
export async function listCalendarBindingCandidates(c:CalendarConfig,start:string,end:string,cursor?:string):Promise<{events:CalendarBindingCandidate[];nextCursor:string|null;unsupported:number}> {
 const microsoft=c.provider==='microsoft',url=new URL(microsoft?endpoint(c).replace(/\/events$/,'/calendarView'):endpoint(c))
 for(const [key,value] of Object.entries(microsoft?{startDateTime:start,endDateTime:end,'$top':'50','$select':'id,subject,start,end,isCancelled','$orderby':'start/dateTime'}:{timeMin:start,timeMax:end,maxResults:'50',singleEvents:'true',showDeleted:'false',orderBy:'startTime'}))url.searchParams.set(key,value)
 if(cursor){
  let parsed:Cursor
  try{if(cursor.length>8192)throw new Error();parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) as Cursor;if(!parsed||!['pageToken','$skiptoken','$skip'].includes(parsed.key)||typeof parsed.value!=='string'||!parsed.value||parsed.value.length>4096|| (microsoft?parsed.key==='pageToken':parsed.key!=='pageToken') || (parsed.key==='$skip'&&!/^\d{1,9}$/.test(parsed.value)))throw new Error()}catch{throw new Error('The calendar page expired. Reload matching events.')}
  url.searchParams.set(parsed.key,parsed.value)
 }
 const body=await read(c,url);if(!body)throw new Error('The selected calendar is unavailable.')
 const rows=microsoft?body.value:body.items
 if(!Array.isArray(rows)||rows.length>2500)throw new Error('Calendar events could not be verified.')
 const events:CalendarBindingCandidate[]=[];let unsupported=0
 for(const row of rows){const candidate=event(row,microsoft);if(!candidate){unsupported++;continue}if(['confirmed','tentative'].includes(candidate.status||'')&&candidate.startDateTime===start&&candidate.endDateTime===end)events.push(candidate)}
 let next:Cursor|null=null
 if(microsoft&&body['@odata.nextLink']){
  const nextURL=new URL(String(body['@odata.nextLink']))
  if(nextURL.origin!==url.origin||nextURL.pathname!==url.pathname||nextURL.username||nextURL.password||nextURL.hash)throw new Error('Calendar pagination could not be verified.')
  for(const name of ['startDateTime','endDateTime'])if(nextURL.searchParams.has(name)&&nextURL.searchParams.get(name)!==url.searchParams.get(name))throw new Error('Calendar page scope changed.')
  const key=nextURL.searchParams.has('$skiptoken')?'$skiptoken':'$skip',value=nextURL.searchParams.get(key)
  if(!value||value.length>4096||(key==='$skip'&&!/^\d{1,9}$/.test(value)))throw new Error('Calendar pagination could not be verified.')
  next={key,value}
 }else if(!microsoft&&body.nextPageToken){if(typeof body.nextPageToken!=='string'||body.nextPageToken.length>4096)throw new Error('Calendar pagination could not be verified.');next={key:'pageToken',value:body.nextPageToken}}
 return {events,nextCursor:next?Buffer.from(JSON.stringify(next)).toString('base64url'):null,unsupported}
}
