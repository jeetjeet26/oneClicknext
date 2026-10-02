import {createHash} from 'node:crypto'
import OpenAI from 'openai'
import {validText} from './material-contracts'
export type KnowledgeModelInput={model:'text-embedding-3-small';dimensions:1536;recipe:'lossless-utf8-4096-v1';chunks:string[];contentHash:string}
export type KnowledgeReceipt={status:'received';providerRequestId:string|null;response:{model:string;data:{index:number;embedding:number[]}[];usage:unknown}}|{status:'uncertain';errorCode:'model_uncertain'}
export function prepareKnowledgeText(content:string):KnowledgeModelInput{
 if(!validText(content))throw new Error('invalid_source')
 const chunks:string[]=[];let chunk='',bytes=0
 for(const char of content){const size=Buffer.byteLength(char,'utf8');if(bytes+size>4096){chunks.push(chunk);chunk='';bytes=0}chunk+=char;bytes+=size}
 if(chunk)chunks.push(chunk)
 return {model:'text-embedding-3-small',dimensions:1536,recipe:'lossless-utf8-4096-v1',chunks,contentHash:createHash('sha256').update(content,'utf8').digest('hex')}
}
export async function executeKnowledgeSearch(input:KnowledgeModelInput):Promise<KnowledgeReceipt>{
 const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:60000})
 const result=await client.embeddings.create({model:input.model,dimensions:input.dimensions,input:input.chunks,encoding_format:'float'})
 return {status:'received',providerRequestId:result._request_id??null,response:{model:result.model,data:result.data.map(row=>({index:row.index,embedding:row.embedding})),usage:result.usage}}
}
