import {describe,it,expect}from'vitest'
import {requireConsoleOrigin}from'./http'
describe('community decisions require the browser request origin',()=>{
 it('accepts the browser authority when Next uses an internal hostname',()=>{
  expect(()=>requireConsoleOrigin(new Request('http://localhost:4321/api/community-brain/portfolio',{headers:{host:'127.0.0.1:4321',origin:'http://127.0.0.1:4321'}}))).not.toThrow()
 })
 it.each([undefined,'null','https://attacker.example','https://console.example.attacker.example'])('rejects absent or foreign origin %s',(origin)=>{
  expect(()=>requireConsoleOrigin(new Request('https://console.example/api/community-brain/portfolio',{headers:{host:'console.example',...(origin?{origin}:{})}}))).toThrow('Open this request from the console')
 })
})
