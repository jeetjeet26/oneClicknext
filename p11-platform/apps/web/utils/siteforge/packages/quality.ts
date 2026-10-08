import { z } from 'zod'
import { load } from 'cheerio'
import { PackageError } from './contracts'
import { safePublicFetch } from '@/utils/services/safe-public-fetch'
const slug=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const websitePlanSchema=z.object({version:z.literal(1),title:z.string().min(1).max(120),pages:z.array(z.object({slug,title:z.string().min(1),contentFile:z.string().regex(/^website\/content\/[a-z0-9-]+\.html$/),floorplanIds:z.array(z.string()).default([])})).min(5).max(20)})
export type WebsitePlan=z.infer<typeof websitePlanSchema>
export function readWebsitePlan(files:Record<string,Uint8Array>):WebsitePlan {
 try{
 const plan=websitePlanSchema.parse(JSON.parse(new TextDecoder().decode(files['website/siteforge-content.json'])));
 const slugs=plan.pages.map(p=>p.slug);if(new Set(slugs).size!==slugs.length||['home','residences','amenities','gallery','contact'].some(s=>!slugs.includes(s)))throw Error('Required page missing');
 for(const p of plan.pages){const html=new TextDecoder().decode(files[p.contentFile]);const $=load(html);if(!files[p.contentFile]||$('h1').length!==1||$.text().trim().split(/\s+/).length<50)throw Error('Incomplete page '+p.slug);if(/<script|<iframe|<form|javascript:/i.test(html))throw Error('Unsupported active content');for(const id of p.floorplanIds)if(!$('[data-floorplan-id]').toArray().some(e=>$(e).attr('data-floorplan-id')===id))throw Error('Floorplan content missing');}
 return plan;
 }catch{throw new PackageError('This WordPress package does not include a complete automatic page setup. Create a new version before previewing.',422)}
}
export function validateDesignEvidence(files:Record<string,Uint8Array>){
 try{const report=JSON.parse(new TextDecoder().decode(files['design-review.json']));if(report.version!==1||report.status!=='reviewed'||!Array.isArray(report.iterations)||report.iterations.length<2||!Array.isArray(report.screenshots))throw Error();
 for(const viewport of ['desktop','mobile']){const evidence=report.screenshots.find((s:{viewport:string;path:string})=>s.viewport===viewport);const b=files[evidence?.path];if(!evidence?.path?.startsWith('review/')||!b||b.length<1000||!Buffer.from(b.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error();}
 if(!files['DESIGN.md']?.length)throw Error();
 }catch{throw new PackageError('Design review is incomplete. The build needs desktop/mobile render evidence and a recorded revision pass.',422)}
}
export function inspectPage(html:string,slug:string,plan:WebsitePlan){
 const $=load(html);$('script,style').remove();const main=$('main');main.find('nav').remove();if(main.length!==1||main.find('h1').length!==1||main.text().trim().split(/\s+/).length<50||/404\s*[·:-]|This page isn.t here|Page not found/i.test(main.text()))throw new PackageError(`The ${slug} page is missing or incomplete.`,409);
 const expected=plan.pages.find(p=>p.slug===slug)!;for(const id of expected.floorplanIds)if(!main.find('[data-floorplan-id]').toArray().some(e=>$(e).attr('data-floorplan-id')===id))throw new PackageError('A floorplan is missing from the rendered website.',409);
 if(['home','residences','gallery'].includes(slug)&&!main.find('img[src]').length)throw new PackageError(`The ${slug} page is missing its imagery.`,409);
 return main.find('img[src]').toArray().map(e=>$(e).attr('src')!);
}
export async function verifyWebsite(url:string,plan:WebsitePlan){
 const origin=new URL(url).origin,images=new Set<string>();const pages=[];
 for(const p of plan.pages){const pageUrl=new URL(p.slug==='home'?'/':'/'+p.slug+'/',origin).href;const r=await safePublicFetch(pageUrl,{maxBytes:2_000_000});if(!r.ok)throw new PackageError(`The ${p.slug} page returned ${r.status}.`,409);const html=await r.text();for(const src of inspectPage(html,p.slug,plan)){const image=new URL(src,pageUrl);if(image.origin!==origin)throw new PackageError('Preview media must be hosted with the website.',409);images.add(image.href)}
 const $=load(html);for(const expected of plan.pages){const path=expected.slug==='home'?'/':'/'+expected.slug+'/';if(!$('nav a[href]').toArray().some(e=>{try{const link=new URL($(e).attr('href')!,origin);return link.origin===origin&&link.pathname===path}catch{return false}}))throw new PackageError(`Navigation is missing ${expected.title}.`,409)}pages.push(p.slug);}
 if(images.size>100)throw new PackageError('Too many preview assets to verify.',409);
 for(const src of images){const r=await safePublicFetch(src,{maxBytes:10_000_000});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw new PackageError('A website image did not load.',409)}
 return {version:1,pages,images:images.size,checkedAt:new Date().toISOString(),designApproval:'requires-human-review'};
}
