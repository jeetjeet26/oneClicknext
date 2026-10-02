import {expect,it,vi} from 'vitest'
it('requires a fresh request for pre-ledger callbacks without calling a provider',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://app.example.com')
 try{const {GET}=await import('./route');const r=await GET();const url=new URL(r.headers.get('location')!);expect(url.searchParams.get('error')).toBe('expired_state');expect(url.searchParams.has('success')).toBe(false);expect(fetch).not.toHaveBeenCalled()}finally{vi.unstubAllGlobals();vi.unstubAllEnvs()}
})
