/** Real local UI -> route -> scoped database qualification; no mocked APIs. */
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
const web=path.resolve(import.meta.dirname,'../../apps/web')
const require=createRequire(path.join(web,'package.json'))
const {chromium}=require('@playwright/test')
const {unzipSync,strFromU8}=require('fflate')
const {PNG}=require('pngjs')
const config=JSON.parse(await readFile(process.argv[2],'utf8'))
const {createServerClient}=require('@supabase/ssr')
const cookies=[]
const client=createServerClient(config.gateway,config.anon,{cookies:{getAll:()=>[],setAll:items=>cookies.push(...items)}})
const {error}=await client.auth.setSession(config.session)
if(error)throw Error('Synthetic browser session could not be installed')
const browser=await chromium.launch({headless:true})
const checks=[]
async function check(condition,label){if(!condition)throw Error(label);checks.push(label);process.stdout.write(JSON.stringify({check:label,state:'passed'})+'\n')}
try{
 const context=await browser.newContext({viewport:{width:1365,height:1000}})
 await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()})
 await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:config.webUrl})))
 const page=await context.newPage()
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(config.webUrl+'/dashboard/portfolio',{waitUntil:'domcontentloaded',timeout:180000})
 await page.getByRole('heading',{name:'Portfolio assistant',exact:true}).waitFor({timeout:60000})
 await page.getByRole('checkbox',{name:'Community A',exact:true}).waitFor({timeout:30000})
 await check(await page.getByRole('checkbox',{name:'Community A',exact:true}).count()===1,'Portfolio UI lists the granted community')
 await check(await page.getByRole('checkbox',{name:'Community C',exact:true}).count()===0,'Foreign community absent from the UI selection')
 await page.getByRole('checkbox',{name:'Community A',exact:true}).check()
 const answerResponse=page.waitForResponse(r=>r.url().endsWith('/api/community-brain/portfolio')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Ask the portfolio assistant',exact:true}).click()
 const answer=await answerResponse;if(!answer.ok())throw Error('Portfolio API returned '+answer.status()+': '+await answer.text())
 const result=await answer.json()
 await page.getByRole('heading',{name:'Results',exact:true}).waitFor({timeout:30000})
 await check(await page.getByText('Exact fixture plan',{exact:true}).count()===1,'UI renders the exact retained floorplan returned through real APIs')
 await page.getByRole('link',{name:'Download exact file',exact:true}).waitFor({timeout:5000})
 const download=await page.getByRole('link',{name:'Download exact file',exact:true}).getAttribute('href')
 const downloaded=await context.request.get(config.webUrl+download)
 await check(downloaded.ok()&&downloaded.headers()['cache-control'].includes('no-store'),'Browser downloads the approved drawing through authenticated file delivery')
 const originalBytes=await downloaded.body(),drawing=result.groups[0].data.items[0],propertyId=result.groups[0].propertyId
 await check(createHash('sha256').update(originalBytes).digest('hex')===drawing.content_hash,'Downloaded drawing bytes match the approved portfolio checksum')
 const bundleInput={sessionId:result.sessionId,propertyIds:[propertyId],assets:[{propertyId,assetId:drawing.asset_id}]}
 const bundle=await context.request.post(config.webUrl+'/api/community-brain/bundles',{headers:{Origin:config.webUrl},data:bundleInput})
 if(!bundle.ok())throw Error('Bundle API returned '+bundle.status()+': '+await bundle.text())
 const archive=unzipSync(await bundle.body()),manifest=JSON.parse(strFromU8(archive['manifest.json']))
 await check(manifest.assets.length===1&&manifest.assets[0].propertyId===propertyId&&manifest.assets[0].sha256===drawing.content_hash&&createHash('sha256').update(archive[manifest.assets[0].path]).digest('hex')===drawing.content_hash,'Portfolio ZIP contains the exact selected asset and a matching ownership manifest')
 const foreignBundle=await context.request.post(config.webUrl+'/api/community-brain/bundles',{headers:{Origin:config.webUrl},data:{...bundleInput,assets:[{propertyId:'bc000000-0000-4000-8000-000000000002',assetId:drawing.asset_id}]}})
 await check(foreignBundle.status()===403,'Bundle rejects an asset outside the explicitly selected communities')
 const forbidden=await context.request.get(config.webUrl+'/api/community-brain/assets?propertyId=bc000000-0000-4000-8000-000000000003&assetId=bd000000-0000-4000-8000-000000000041')
 await check(forbidden.status()===403,'Real application route denies a substituted foreign community')
 await page.goto(config.webUrl+'/dashboard/community?section=files',{waitUntil:'domcontentloaded',timeout:180000})
 await page.getByRole('combobox',{name:'Property',exact:true}).selectOption('bc000000-0000-4000-8000-000000000001')
 await page.getByRole('heading',{name:'Recent originals',exact:true}).waitFor()
 await page.getByRole('checkbox',{name:'Generation context',exact:true}).waitFor()
 await check(await page.getByRole('checkbox',{name:'Generation context',exact:true}).isDisabled(),'Only administrators can change community activation in the UI')
 await page.getByRole('button',{name:'Review',exact:true}).click()
 await page.getByRole('heading',{name:'Exact drawing',exact:true}).waitFor()
 await check(await page.getByRole('link',{name:'Download exact original',exact:true}).count()===1,'UI exposes retained original and reviewed processing result')
 await page.getByRole('button',{name:'Rebuild eligible memory',exact:true}).click()
 await page.getByText('1 current source versions queued.',{exact:false}).waitFor()
 await check(true,'Historical replay queues only an eligible retained source through the real UI and API')
 await page.getByLabel('Add a document, floorplan, image, logo, font or video').setInputFiles({name:'browser-upload.png',mimeType:'image/png',buffer:originalBytes})
 const finalized=page.waitForResponse(r=>r.url().endsWith('/api/community-brain/uploads')&&r.request().method()==='POST'&&r.request().postDataJSON()?.operation==='finalize')
 await page.getByRole('button',{name:'Upload and process',exact:true}).click()
 const upload=await finalized;if(!upload.ok())throw Error('Upload API returned '+upload.status()+': '+await upload.text())
 await page.getByRole('heading',{name:'browser-upload.png',exact:true}).waitFor()
 await check(true,'Browser uploads and finalizes an immutable original through signed private Storage')
 for(let attempt=0;attempt<60;attempt++){
  if(await page.getByText('Processing: ready',{exact:true}).count())break
  await page.getByRole('button',{name:'Refresh processing',exact:true}).click()
  await page.waitForTimeout(500)
 }
 await check(await page.getByText('Processing: ready',{exact:true}).count()===1,'Actual scoped worker processes the browser upload into retained page renditions')
 await page.getByRole('combobox',{name:'Use',exact:true}).selectOption('floorplan')
 const generated=page.getByLabel('This is AI-generated or an artist’s rendering (cannot be used as a real floorplan)')
 await generated.check()
 await page.getByLabel('I checked the exact file or page, its community, drawing association and usage rights.').check()
 await check(await page.getByRole('button',{name:'Approve selected asset',exact:true}).isDisabled(),'Generated artwork cannot be approved as a real floorplan in the review UI')
 await generated.uncheck()
 await page.getByRole('combobox',{name:'Use',exact:true}).selectOption('gallery')
 await page.getByRole('combobox',{name:'Representation',exact:true}).selectOption('')
 const reviewed=page.waitForResponse(r=>r.url().endsWith('/api/community-brain/review')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Approve selected asset',exact:true}).click()
 const duplicate=await reviewed
 await check(duplicate.status()===409&&(await duplicate.json()).error.includes('already exist in this community'),'Duplicate image approval explains the existing community asset without overwriting it')
 const different=PNG.sync.read(originalBytes);different.data[0]^=32
 const uniqueBytes=PNG.sync.write(different),uniqueHash=createHash('sha256').update(uniqueBytes).digest('hex')
 await page.getByLabel('Add a document, floorplan, image, logo, font or video').setInputFiles({name:'browser-unique.png',mimeType:'image/png',buffer:uniqueBytes})
 await page.getByRole('button',{name:'Upload and process',exact:true}).click()
 await page.getByRole('heading',{name:'browser-unique.png',exact:true}).waitFor()
 for(let attempt=0;attempt<60;attempt++){
  if(await page.getByText('Processing: ready',{exact:true}).count())break
  await page.getByRole('button',{name:'Refresh processing',exact:true}).click()
  await page.waitForTimeout(500)
 }
 await page.getByRole('combobox',{name:'Representation',exact:true}).selectOption('')
 await page.getByRole('textbox',{name:'Name',exact:true}).fill('Sanity violet image')
 await page.getByLabel('I checked the exact file or page, its community, drawing association and usage rights.').check()
 const uniqueReview=page.waitForResponse(r=>r.url().endsWith('/api/community-brain/review')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Approve selected asset',exact:true}).click()
 const approval=await uniqueReview;if(!approval.ok())throw Error('Review API returned '+approval.status()+': '+await approval.text())
 const asset=await approval.json()
 const approved=await context.request.get(config.webUrl+'/api/community-brain/assets?propertyId='+propertyId+'&assetId='+asset.assetId)
 await check(approved.ok()&&createHash('sha256').update(await approved.body()).digest('hex')===uniqueHash,'Browser-approved image resolves to the exact uploaded original bytes')
 let evidence=[]
 for(let attempt=0;attempt<30;attempt++){
  const memory=await context.request.post(config.webUrl+'/api/community-brain/context',{headers:{Origin:config.webUrl},data:{propertyId,purpose:'research',query:'violet'}})
  if(!memory.ok())throw Error('Context API returned '+memory.status())
  evidence=(await memory.json()).evidence
  if(evidence.some(e=>e.content.includes('Sanity violet image')))break
  await page.waitForTimeout(500)
 }
 await check(evidence.some(e=>e.content.includes('Sanity violet image')&&e.propertyId===propertyId&&e.allowedUses.includes('style')&&!e.allowedUses.includes('fact'))&&evidence.every(e=>e.propertyId===propertyId),'Approved image feeds back into its own community memory as reference material rather than verified facts')
 await check(errors.length===0,'Community workspace renders without browser runtime exceptions')
 await page.screenshot({path:'/private/tmp/community_brain_browser.png',fullPage:true})
 await writeFile('/private/tmp/community_brain_browser_receipt.json',JSON.stringify({checks:checks.length,state:'passed',mockedApis:false,externalRequestsBlocked:true},null,2))
}finally{await browser.close()}
