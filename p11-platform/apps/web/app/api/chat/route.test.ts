import {it,expect}from 'vitest'
import {POST}from './route'
it('retires the unused console chat write/model bypass',async()=>{const response=await POST();expect(response.status).toBe(410);expect(await response.json()).toEqual({error:expect.stringContaining('recorded conversation inbox')});expect(response.headers.get('Cache-Control')).toBe('no-store')})
