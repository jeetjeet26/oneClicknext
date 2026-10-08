import {describe,it,expect,vi} from 'vitest'
import {strToU8} from 'fflate'
import {readWebsitePlan,inspectPage,validateDesignEvidence,verifyWebsite} from './quality'
vi.mock('@/utils/services/safe-public-fetch',()=>({safePublicFetch:vi.fn()}))
import {safePublicFetch} from '@/utils/services/safe-public-fetch'
const slugs=['home','residences','amenities','gallery','contact'];const words='A considered place to live with room for everyday life. '.repeat(8)
const plan={version:1 as const,title:'Demo',pages:slugs.map(slug=>({slug,title:slug,contentFile:`website/content/${slug}.html`,floorplanIds:slug==='residences'?['plan-one']:[]}))}
const content=(slug:string)=>`<h1>${slug}</h1><p>${words}</p><img src="/photo.png" alt="Courtyard"><section data-floorplan-id="plan-one">One bedroom</section>`
describe('complete website acceptance',()=>{
 it('rejects old theme-only packages before installation',()=>{expect(()=>readWebsitePlan({})).toThrow('automatic page setup')})
 it('requires actual page content and floorplan cards',()=>{const files=Object.fromEntries(plan.pages.map(p=>[p.contentFile,strToU8(content(p.slug))]));files['website/siteforge-content.json']=strToU8(JSON.stringify(plan));expect(readWebsitePlan(files).pages).toHaveLength(5);files['website/content/residences.html']=strToU8('<h1>Coming soon</h1>');expect(()=>readWebsitePlan(files)).toThrow()})
 it('rejects an empty homepage even with a working theme',()=>{expect(()=>inspectPage('<header>Demo</header><main></main><footer>copyright</footer>','home',plan)).toThrow('missing or incomplete')})
 it('accepts a semantic page header inside main without counting the site footer',()=>{expect(inspectPage(`<header>Site header</header><main><header><h1>Home</h1></header><p>${words}</p><img src="/photo.png"></main><footer>Footer</footer>`,'home',plan)).toEqual(['/photo.png'])})
 it('rejects a soft 404 with HTTP 200',()=>{expect(()=>inspectPage(`<main><h1>Page not found</h1>${words}</main>`,'residences',plan)).toThrow()})
 it('rejects missing image and missing floorplan independently',()=>{expect(()=>inspectPage(`<main><h1>Home</h1>${words}</main>`,'home',plan)).toThrow('imagery');expect(()=>inspectPage(`<main><h1>Residences</h1>${words}<img src="a"></main>`,'residences',plan)).toThrow('floorplan')})
 it('does not accept a claimed design review without render evidence',()=>{expect(()=>validateDesignEvidence({'design-review.json':strToU8(JSON.stringify({version:1,status:'reviewed',iterations:[{},{}],screenshots:[]}))})).toThrow('render evidence')})
 it('checks every page and fails when an actual asset is broken',async()=>{vi.mocked(safePublicFetch).mockImplementation(async url=>url.endsWith('.png')?new Response('',{status:404}):new Response(`<nav>${slugs.map(s=>`<a href="${s==='home'?'/':'/'+s+'/'}">${s}</a>`).join('')}</nav><main>${content(url.includes('residences')?'residences':'home')}</main>`));await expect(verifyWebsite('https://example.com',plan)).rejects.toThrow('image did not load')})
})
