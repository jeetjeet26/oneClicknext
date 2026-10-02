import {expect,it} from 'vitest'
import {generateCalendarLinks,generateICSContent} from './calendar-invite'
it('exports one exact property instant consistently in links and the calendar download',()=>{
 const links=generateCalendarLinks({propertyName:'Fixture',tourDate:'2026-11-01',tourTime:'01:30',tourType:'in_person',startsAt:'2026-11-01T09:30:00Z',durationMinutes:45,uid:'fixture-v1@p11'})
 expect(new URL(links.google).searchParams.get('dates')).toBe('20261101T093000Z/20261101T101500Z')
 const ics=Buffer.from(links.icsDownload.split(',').slice(1).join(','),'base64').toString()
 expect(ics).toContain('DTSTART:20261101T093000Z');expect(ics).toContain('DTEND:20261101T101500Z');expect(ics).toContain('UID:fixture-v1@p11')
})
it('keeps the confirmation attachment stable across retries when supplied the saved booking stamp',()=>{
 const data={title:'Fixture',startDate:'2026-09-16',startTime:'10:00',startsAt:'2026-09-16T17:00:00Z',durationMinutes:30,uid:'fixture-v1@p11',timestamp:'2026-09-15T17:00:00Z'}
 expect(generateICSContent(data)).toBe(generateICSContent(data));expect(generateICSContent(data)).toContain('DTSTAMP:20260915T170000Z')
})
it('rejects an invalid explicit calendar instant',()=>{expect(()=>generateICSContent({title:'Fixture',startDate:'2026-09-16',startTime:'10:00',startsAt:'invalid',durationMinutes:30})).toThrow()})
