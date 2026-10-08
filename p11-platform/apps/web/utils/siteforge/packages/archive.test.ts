import { describe,it,expect } from 'vitest'
import { strToU8,strFromU8,zipSync } from 'fflate'
import { unpackPackage,retainFinishedPackage } from './archive'

const text=(value:string)=>strToU8(value)
const source=()=>zipSync({'property.json':text(JSON.stringify({floorplans:[{id:'plan-a'}]})),'assets/plan-a.png':new Uint8Array([1,2,3]),'source-manifest.json':text('{}')})
const site=(floorplanIds=['plan-a'])=>({
  'website/index.html':text('<!doctype html><title>Example</title><h1>Example</h1>'),
  'INSTALL.md':text('Upload website/'),'EDITING.md':text('Edit HTML files'),'REVIEW.md':text('Review content and keyboard access'),
  'build-report.json':text('{"checks":[],"notRun":["browser"]}'),
  'component-bindings.json':text(JSON.stringify({version:1,floorplanIds,components:[{name:'Floorplans',sourceFields:['floorplans'],editableIn:'website/index.html'}]})),
})
describe('finished website package boundary',()=>{
  it('retains all original assets and source, with independent verification explicitly pending',()=>{
    const files=unpackPackage(retainFinishedPackage(zipSync(site()),source(),{id:'build-a',source_hash:'hash-a',target:'standalone'}))
    expect(files['source/assets/plan-a.png']).toEqual(new Uint8Array([1,2,3]))
    const receipt=JSON.parse(strFromU8(files['P11-PACKAGE.json']))
    expect(receipt).toMatchObject({model:'gpt-6-astra',sourceHash:'hash-a',requiresHumanReview:true,independentRuntimeVerification:'pending'})
    expect(receipt.fileHashes['website/index.html']).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects a website that lost a saved floorplan',()=>{
    expect(()=>retainFinishedPackage(zipSync(site([])),source(),{id:'build-a',source_hash:'hash-a',target:'standalone'})).toThrow('every approved floorplan')
  })
  it('rejects a brief or fabricated completion without website source',()=>{
    expect(()=>retainFinishedPackage(zipSync({'README.md':text('Done')}),source(),{id:'build-a',source_hash:'hash-a',target:'standalone'})).toThrow('missing INSTALL.md')
  })
  it.each(['../escape.php','/absolute.php','a/../../escape.php','C:\\escape.php','a\\escape.php'])('rejects unsafe path %s',name=>{
    expect(()=>unpackPackage(zipSync({[name]:text('unsafe')}))).toThrow()
  })
  it('rejects symlinks and ambiguous duplicate names',()=>{
    expect(()=>unpackPackage(zipSync({'link':[text('/etc/passwd'),{os:3,attrs:0xa1ff0000}]}))).toThrow('unsafe')
    expect(()=>unpackPackage(zipSync({'Index.html':text('a'),'index.html':text('b')}))).toThrow('unsafe')
  })
  it('rejects decompression bombs before allocation',()=>{
    expect(()=>unpackPackage(zipSync({'huge.txt':new Uint8Array(11_000_000)}))).toThrow('oversized')
  })
  it('refuses a theme-only package without full page installation data',()=>{
    const output={...site(),'website/style.css':text('/* Theme Name: Test */'),'website/index.php':text('<?php get_header(); ?>'),'website/functions.php':text('<?php // editing setup')}
    expect(()=>retainFinishedPackage(zipSync(output),source(),{id:'build-a',source_hash:'hash-a',target:'wordpress'})).toThrow('automatic page setup')
  })
})

it('requires a matching component-guide version in enriched packages',()=>{
 const input=zipSync({'property.json':text(JSON.stringify({version:2,floorplans:[{id:'plan-a'}],componentGuides:[{id:'p11.floorplans',version:'1.0.0'}]}))});
 const output=site();
 expect(()=>retainFinishedPackage(zipSync(output),input,{id:'build',source_hash:'hash',target:'standalone'})).toThrow('versioned P11');
 output['component-bindings.json']=text(JSON.stringify({version:1,floorplanIds:['plan-a'],components:[{name:'Floorplans',guideId:'p11.floorplans',guideVersion:'1.0.0',sourceFields:['floorplans'],editableIn:'website/index.html'}]}));
 expect(()=>retainFinishedPackage(zipSync(output),input,{id:'build',source_hash:'hash',target:'standalone'})).not.toThrow();
})
