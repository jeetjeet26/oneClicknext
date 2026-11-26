import { createHash } from 'node:crypto'
import { Browserbase } from '@browserbasehq/sdk'
import type { Browser } from 'playwright-core'
import { safePublicFetchWithMetadata } from '@/utils/services/safe-public-fetch'
import { parseResearchHtml, publicResearchUrl, type ResearchDocument } from './research-source'

/** Remote, unauthenticated rendering. Every HTTP resource is fetched through the pinned public-only transport. */
export async function renderResearchDocument(entityKey:string,url:string,kind:ResearchDocument['kind']):Promise<ResearchDocument|null>{
  if(!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID || !publicResearchUrl(url))return null
  const client=new Browserbase({apiKey:process.env.BROWSERBASE_API_KEY,timeout:15000,maxRetries:0})
  let sessionId:string|null=null,browser:Browser|null=null
  try{
    // Browser capture is optional; its runtime must never prevent saved research reads.
    const {chromium}=await import('playwright-core')
    const session=await client.sessions.create({projectId:process.env.BROWSERBASE_PROJECT_ID})
    sessionId=session.id
    browser=await chromium.connectOverCDP(session.connectUrl,{timeout:15000})
    const context=await browser.newContext({serviceWorkers:'block'})
    let requests=0
    await context.route('**/*',async route=>{
      const request=route.request()
      if(request.method()!=='GET' || ++requests>90 || ['image','font','media'].includes(request.resourceType()))return route.abort()
      try{
        const {response}=await safePublicFetchWithMetadata(request.url(),{timeoutMs:12000,maxBytes:2000000,headers:{accept:request.headers().accept || '*/*'},redirect:'manual'})
        const headers=Object.fromEntries(response.headers)
        delete headers['content-encoding'];delete headers['content-length'];delete headers['set-cookie']
        await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
      }catch{await route.abort()}
    })
    await context.routeWebSocket('**/*',socket=>socket.close())
    const page=await context.newPage()
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000})
    await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>undefined)
    const finalUrl=page.url(),body=await page.content(),parsed=parseResearchHtml(body,finalUrl)
    if(!publicResearchUrl(finalUrl) || parsed.text.length<50)throw new Error('No usable rendered source')
    return {id:crypto.randomUUID(),entityKey,url:finalUrl,title:parsed.title,fetchedAt:new Date().toISOString(),kind,status:'captured',text:parsed.text.slice(0,80000),contentHash:createHash('sha256').update(body).digest('hex'),metadata:{parser:'research-rendered-v1',transport:'browserbase_public_only',partial:parsed.text.length>80000,links:parsed.links,images:parsed.images,structuredData:parsed.structuredData,terms:parsed.terms}}
  }catch{return null}finally{await browser?.close().catch(()=>undefined);if(sessionId)await client.sessions.update(sessionId,{projectId:process.env.BROWSERBASE_PROJECT_ID,status:'REQUEST_RELEASE'}).catch(()=>undefined)}
}
