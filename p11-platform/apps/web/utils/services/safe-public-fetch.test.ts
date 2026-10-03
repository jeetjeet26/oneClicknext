import {describe,it,expect,vi,beforeEach} from 'vitest'
const lookup=vi.hoisted(()=>vi.fn())
vi.mock('node:dns/promises',()=>({lookup}))
import {isPublicAddress,resolvePublicTarget,UnsafePublicUrl} from './safe-public-fetch'
beforeEach(()=>vi.clearAllMocks())
describe('public destination boundary',()=>{
 it.each(['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','192.0.2.8','198.18.0.1','224.0.0.1','::1','::ffff:7f00:1','2002:7f00:1::','2001:db8::1','fd00::1'])('rejects reserved address %s',ip=>expect(isPublicAddress(ip)).toBe(false))
 it.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('allows global address %s',ip=>expect(isPublicAddress(ip)).toBe(true))
 it.each(['file:///tmp/file','http://user:pass@example.com','http://localhost.','http://example.com:8080'])('rejects unsafe URL %s',async url=>await expect(resolvePublicTarget(url)).rejects.toThrow())
 it('rejects mixed public/private DNS answers',async()=>{
  lookup.mockResolvedValue([{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}])
  await expect(resolvePublicTarget('https://example.com')).rejects.toBeInstanceOf(UnsafePublicUrl)
 })
 it('returns the validated address to pin at connection time',async()=>{
  lookup.mockResolvedValue([{address:'1.1.1.1',family:4}])
  expect(await resolvePublicTarget('https://example.com')).toMatchObject({host:'example.com',address:{address:'1.1.1.1',family:4}})
  expect(lookup).toHaveBeenCalledOnce()
 })
})
