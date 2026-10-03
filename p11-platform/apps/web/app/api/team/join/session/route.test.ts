import{it,expect}from'vitest'
import{POST}from'./route'
const req=(token='a'.repeat(64),origin='https://local')=>new Request('https://local/api/team/join/session',{method:'POST',headers:{origin},body:JSON.stringify({token})})
it('holds invitation in a scoped private expiring cookie without returning secret',async()=>{const r=await POST(req());expect(r.status).toBe(200);expect(await r.json()).toEqual({state:'ready'});for(const value of['HttpOnly','Secure','SameSite=lax','Path=/api/team/join','Max-Age=1800'])expect(r.headers.get('set-cookie')).toContain(value);expect(r.headers.get('referrer-policy')).toBe('no-referrer')})
it('rejects a forged origin or malformed fragment before setting a cookie',async()=>{for(const r of[await POST(req('a'.repeat(64),'https://outside')),await POST(req('bad'))]){expect(r.status).toBeGreaterThanOrEqual(400);expect(r.headers.get('set-cookie')).toBeNull()}})
