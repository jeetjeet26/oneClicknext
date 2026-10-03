import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest,NextResponse } from 'next/server'
import { createHash,randomUUID } from 'node:crypto'
import { buildCorsHeaders } from './api-helpers'
import { lumaRequestContext } from './luma-request-context'
import { lumaEvidenceRpc } from './luma-model-evidence'
import { isWidgetSessionExpired } from './widget-session'

export async function withLumaRequest(req: NextRequest, operation: 'chat'|'lead'|'tours', handler: (req: NextRequest)=>Promise<NextResponse>) {
  const headers = {...buildCorsHeaders(req.headers.get('origin'), 'POST, OPTIONS'), 'Cache-Control':'no-store'}
  const respond = (error: string, status: number, code?:string) => NextResponse.json({error,code},{status,headers})
  try {
    const reader = req.clone().body?.getReader()
    let text = ''
    let bytes = 0
    const decoder = new TextDecoder()
    if(reader) {
      while(true) {
        const chunk = await reader.read()
        if(chunk.done) break
        bytes += chunk.value.byteLength
        if(bytes > 24000) {void reader.cancel();return respond('Request is too large',413)}
        text += decoder.decode(chunk.value,{stream:true})
      }
      text += decoder.decode()
    }
    let body: Record<string,unknown>
    try { body = JSON.parse(text) } catch {return respond('Invalid request body',400)}
    if(!body || typeof body!=='object' || Array.isArray(body)) return respond('Invalid request body',400)
    const requestId = body.requestId ?? randomUUID()
    if (typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return respond('Invalid request identity',400)
    const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || req.nextUrl.searchParams.get('apiKey') || req.nextUrl.searchParams.get('api_key')
    if (!apiKey) return respond('API key required',401)
    const db = createServiceClient()
    const {data:config,error} = await db.from('lumaleasing_config').select('property_id').eq('api_key',apiKey).eq('is_active',true).single()
    if (error && error.code!=='PGRST116') return respond('Widget is temporarily unavailable',503)
    if (!config) return respond('Widget is unavailable',401)
    const propertyId = config.property_id
    if (!propertyId) return respond('Widget property is unavailable',404)
    if (body.sessionId) {
      if(typeof body.sessionId!=='string') return respond('Invalid session',400)
      const session = await db.from('widget_sessions').select('*').eq('id',body.sessionId).eq('property_id',propertyId).maybeSingle()
      if(session.error) return respond('Session could not be checked',503)
      if(!session.data) return respond('Session not found',404,'invalid_widget_session')
      if(isWidgetSessionExpired(session.data)) return respond('Session expired',410,'session_expired')
    }
    const actor = createHash('sha256').update(req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-visitor-id') || 'anonymous').digest('hex')
    const claimed = await lumaEvidenceRpc(db,'claim_recorded_luma_request',{p_property_id:propertyId,p_request_id:requestId,p_operation:operation,p_raw_input:text,p_actor:actor,p_key_hash:createHash('sha256').update(apiKey).digest('hex')})
    if (claimed.error || !claimed.data) return respond('Unable to save this request. Please try again.',503)
    const claim = claimed.data as {state:string;token?:string;response?:Json;http_status?:number}
    if (claim.state==='completed') return NextResponse.json(claim.response,{status:claim.http_status ?? 200,headers})
    if (claim.state==='forbidden') return respond('Widget is unavailable',401)
    if (claim.state==='invalid_input') return respond('Invalid request body',400)
    if (claim.state==='conflict') return respond('This request identity was already used for different information.',409,'request_conflict')
    if (claim.state==='limited') return respond('Please wait a moment before trying again.',429,'rate_limited')
    if (claim.state==='review') return respond('This request needs a status check before it can be repeated. Please contact the property team.',409,'request_needs_review')
    if (claim.state!=='claimed' || !claim.token) return respond('Your request is still being processed. Please wait.',409,'request_processing')
    const response = await lumaRequestContext.run({propertyId,requestId,token:claim.token},()=>handler(req))
    const result = await response.clone().json()
    const saved = await lumaEvidenceRpc(db,'finish_recorded_luma_request',{p_property_id:propertyId,p_request_id:requestId,p_token:claim.token,p_response:result,p_status:response.status})
    if (saved.error || !saved.data) return respond('Your request may have been saved. Please retry the same request to check its status.',503,'request_status_unknown')
    response.headers.set('Cache-Control','no-store')
    return response
  } catch {
    return respond('Unable to process this request. Please try again.',503)
  }
}

export async function saveLumaMessage(db: ReturnType<typeof createServiceClient>, propertyId:string, conversationId:string, role:'user'|'assistant', content:string, modeRevision?:number) {
  const {data,error}=await(db as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>}).rpc('save_luma_message_at_revision',{p_property_id:propertyId,p_conversation_id:conversationId,p_role:role,p_content:content,p_mode_revision:modeRevision??null})
  if(error||!data)throw new Error('Could not confirm saved message')
  return data as {saved:boolean;human:boolean;stale?:boolean;id?:string;modeRevision:number}
}

/** Link the saved contact, visitor session and existing conversations in one transaction. */
export async function linkLumaVisitorLead(db:ReturnType<typeof createServiceClient>,propertyId:string,leadId:string,sessionId:string|null,conversationId:string|null){
 const context=lumaRequestContext.getStore()
 if(!context||context.propertyId!==propertyId)throw new Error('A recorded visitor request is required to link contact details.')
 const{data,error}=await lumaEvidenceRpc(db,'link_luma_visitor_lead',{p_property_id:propertyId,p_request_id:context.requestId,p_token:context.token,p_session_id:sessionId,p_conversation_id:conversationId,p_lead_id:leadId})
 const saved=data as{state?:string;leadId?:string}|null
 if(error||saved?.state!=='saved'||saved.leadId!==leadId)throw new Error('The contact was saved, but its visitor link is not confirmed. The property team can review this request.')
}
