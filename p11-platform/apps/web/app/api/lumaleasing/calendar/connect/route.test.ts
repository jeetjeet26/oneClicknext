import {expect,it} from 'vitest'
import {NextRequest} from 'next/server'
import {GET} from './route'
it.each(['google','microsoft'])('uses the saved authorization entry point for %s',async provider=>{
 const r=await GET(new NextRequest(`http://localhost/api/lumaleasing/calendar/connect?propertyId=fixture&provider=${provider}`));const url=new URL(r.headers.get('location')!);expect(url.pathname).toBe(`/api/lumaleasing/integrations/oauth/${provider}/start`);expect(url.searchParams.get('propertyId')).toBe('fixture');expect(url.searchParams.get('capabilities')).toBe('calendar')
})
it('rejects a missing property',async()=>expect((await GET(new NextRequest('http://localhost/api/lumaleasing/calendar/connect'))).status).toBe(400))
it('rejects an unsupported provider',async()=>expect((await GET(new NextRequest('http://localhost/api/lumaleasing/calendar/connect?propertyId=p&provider=unknown'))).status).toBe(400))
