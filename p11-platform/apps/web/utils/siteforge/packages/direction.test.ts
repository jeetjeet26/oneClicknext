import {describe,expect,it} from 'vitest'
import type {Document} from '@/utils/intelligence/contracts'
import {selectPackageDirection} from './direction'
const brief={id:'brief',kind:'creative',status:'approved',revision:3,payload:{title:'Earlier concept',palette:'red'}} as Document
const website={id:'direction',website_id:'website',name:'Selected website concept',direction:{palette:'blue'},content_hash:'a'.repeat(64)}
describe('website design authority',()=>{
  it('uses the approved website direction even when a competing property brief exists',()=>{
    const result=selectPackageDirection(website,brief)
    expect(result).toMatchObject({source:'website',websiteId:'website',content:{palette:'blue'}})
    expect(JSON.stringify(result)).not.toContain('red')
  })
  it('retains an approved property brief as the fallback for a new website',()=>{
    expect(selectPackageDirection(null,brief)).toMatchObject({source:'property_brief',id:'brief',revision:3,content:{palette:'red'}})
  })
  it('never turns a draft or unrelated document into approved design instructions',()=>{
    expect(selectPackageDirection(null,{...brief,status:'draft'})).toBeNull()
    expect(selectPackageDirection(null,{...brief,kind:'fact'})).toBeNull()
    expect(selectPackageDirection(null,null)).toBeNull()
  })
})
