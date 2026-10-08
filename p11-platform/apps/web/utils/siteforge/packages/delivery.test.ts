import {describe,it,expect,vi} from 'vitest'
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate'
vi.mock('server-only',()=>({}))
import {themeArchive} from './delivery'
const slug='p11-astra-1234567890abcdef12345678'
describe('generated theme deployment archive',()=>{
 it('installs only website files into a unique folder, retaining exact content bytes',()=>{
  const original={'website/style.css':strToU8('/* Theme Name: Demo */'),'website/functions.php':strToU8('<?php // editable theme'),'website/index.php':strToU8('<?php get_header();'),'source/property.json':strToU8('private source'),'INSTALL.md':strToU8('instructions')};
  const out=unzipSync(themeArchive(zipSync(original),slug));expect(Object.keys(out)).toHaveLength(3);expect(strFromU8(out[slug+'/functions.php'])).toBe('<?php // editable theme');expect(Object.keys(out).some(k=>k.includes('source'))).toBe(false)
 })
 it('rejects missing WordPress files',()=>{expect(()=>themeArchive(zipSync({'website/index.html':strToU8('static')}),slug)).toThrow('installable')})
 it('rejects unsafe destination names before remote work',()=>{expect(()=>themeArchive(new Uint8Array(),'../existing-theme')).toThrow('identity')})
 it('rejects traversal in generated archives',()=>{expect(()=>themeArchive(zipSync({'website/../../wp-config.php':strToU8('bad')}),slug)).toThrow()})
})
