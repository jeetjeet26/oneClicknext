import {describe,it,expect,vi} from 'vitest'
import {resolveDestinationSsh} from './destination-credentials'
import type {StoredWordPressCredential} from '@/utils/siteforge/wordpress/credential-vault'
const target={url:'https://staging.example.com',applicationId:'123',serverId:'456'}
const credential={provider:'cloudways',url:target.url,username:'wp',password:'rest-secret',ssh:{host:'old-host',port:22,username:'old-user',password:'old-password',applicationRoot:'public_html'},providerMetadata:{provider:'cloudways',applicationId:'123',serverId:'456',publicIp:'old-host'}} satisfies StoredWordPressCredential
const app={id:123,server_id:456,app_fqdn:'staging.example.com',sys_user:'app_folder',master_user:'master',public_ip:'192.0.2.1'}
describe('exact destination SSH resolution',()=>{
 it('resolves both verified paths using the existing server key instead of stale stored password',async()=>{
  const result=await resolveDestinationSsh(target,credential,'key\\nline',async()=>app)
  expect(result).toMatchObject({host:'192.0.2.1',username:'master',privateKey:'key\nline',applicationRoot:'/home/master/applications/app_folder/public_html',sftpApplicationRoot:'/applications/app_folder/public_html'})
  expect(result.password).toBeUndefined()
 })
 it.each([{id:999},{server_id:999},{app_fqdn:'other.example.com'},{sys_user:'../other'}])('rejects provider mismatches %s',async patch=>{
  await expect(resolveDestinationSsh(target,credential,'key',async()=>({...app,...patch}))).rejects.toThrow('exact selected')
 })
 it('rejects a vault mismatch before any provider lookup',async()=>{
  const lookup=vi.fn(async()=>app)
  await expect(resolveDestinationSsh({...target,applicationId:'other'},credential,'key',lookup)).rejects.toThrow('do not match')
  expect(lookup).not.toHaveBeenCalled()
 })
 it('reports missing paths accurately without a configured key',async()=>{
  await expect(resolveDestinationSsh(target,credential,undefined,async()=>app)).rejects.toThrow('missing its verified SSH and SFTP paths')
 })
 it('retains complete password connections when no key is configured',async()=>{
  const c={...credential,ssh:{...credential.ssh,sftpApplicationRoot:'public_html'}}
  expect(await resolveDestinationSsh(target,c,undefined,async()=>app)).toEqual(c.ssh)
 })
})
