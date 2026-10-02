import {createHash} from 'node:crypto'
import {load} from 'cheerio'
import {safePublicFetchWithMetadata,UnsafePublicUrl} from '@/utils/services/safe-public-fetch'
import type {WebReceipt} from './web-contracts'
const limitations=['Static response text only; JavaScript, images, styling, linked pages and authenticated content are not loaded.','Text order reflects the parsed response, not a verified visual rendering. Review the original and source before accepting facts.']
export async function captureWebsite(url:string):Promise<WebReceipt>{
 const receipt:WebReceipt={recipe:'public-utf8-html-v1',complete:false,requestedUrl:url,fetchedAt:new Date().toISOString(),limitations}
 try{
  const{response,finalUrl}=await safePublicFetchWithMetadata(url,{timeoutMs:25000,maxBytes:1048576,headers:{accept:'text/html, application/xhtml+xml, text/plain'}})
  Object.assign(receipt,{fetchedAt:new Date().toISOString(),finalUrl,statusCode:response.status,contentType:(response.headers.get('content-type')||'').slice(0,200)})
  if(!response.ok)return{...receipt,errorCode:'http_error'}
  const type=receipt.contentType!.split(';')[0].trim().toLowerCase(),charset=receipt.contentType!.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.toLowerCase()
  if(!['text/html','application/xhtml+xml','text/plain'].includes(type))return{...receipt,errorCode:'unsupported_content'}
  if(charset&&!['utf-8','utf8','us-ascii'].includes(charset))return{...receipt,errorCode:'unsupported_encoding'}
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>1048576)return{...receipt,errorCode:'response_limit'}
  let body:string;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{return{...receipt,errorCode:'invalid_utf8'}}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body))return{...receipt,errorCode:'unsupported_control_bytes'}
  receipt.body=body;receipt.bodyHash=createHash('sha256').update(bytes).digest('hex')
  let text=body
  if(type!=='text/plain'){
   const $=load(body);receipt.title=$('title').first().text().trim().slice(0,500)
   $('script,style,noscript,template,svg,iframe,[hidden],[aria-hidden="true"]').remove();$('br,hr').replaceWith('\n');$('p,div,section,article,li,td,th,h1,h2,h3,h4,h5,h6').append('\n');text=$('body').text()
   text=text.replace(/\u00a0/g,' ').replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()
  }
  if(Buffer.byteLength(text)>1048576)return{...receipt,errorCode:'text_limit'}
  receipt.text=text
  if(!text.trim())return{...receipt,errorCode:'no_text'}
  if(/^(just a moment|attention required|access denied|verify (?:that )?you are human)/i.test(receipt.title||'')||(text.length<1500&&/verify (?:that )?you are human|checking your browser|enable javascript and cookies to continue/i.test(text)))return{...receipt,errorCode:'challenge_page'}
  return{...receipt,complete:true}
 }catch(error){return{...receipt,errorCode:error instanceof UnsafePublicUrl?'unsafe_source':'fetch_unconfirmed'}}
}
