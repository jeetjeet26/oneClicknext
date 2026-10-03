import {createHash} from 'node:crypto'
import {z} from 'zod'
import {reviewContentFingerprint} from './ingestion'
import {safePublicationUrl} from './publication-contracts'
export const INTAKE_CONTRACT_VERSION='review-intake-v1'
export const INTAKE_MAX_BYTES=2_000_000
export const INTAKE_MAX_ROWS=500
const platforms=['google','yelp','apartments_com','facebook','other'] as const
export type IntakeRow={platform:typeof platforms[number];platformReviewId:string;identityBasis:'provider_id'|'content_fingerprint';reviewerName:string;reviewerAvatarUrl:string|null;rating:number|null;reviewText:string;reviewDate:string|null;fingerprint:string;legacyFingerprint:string}
export type ParsedIntake={contractVersion:string;reviews:IntakeRow[];duplicateRows:number;retrievalMethod:'provider_api'|'scraper'|'manual'|'csv_import';completeness:'complete'|'sample'|'degraded'|'unknown';note:string|null;sourceHash:string}
export class IntakeValidationError extends Error{constructor(message:string,readonly row?:number){super(row?`Row ${row}: ${message}`:message)}}
export function intakeHash(value:string){return createHash('sha256').update(value).digest('hex')}
function date(value:unknown,row:number){if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||(!/^\d{4}-\d{2}-\d{2}$/.test(value)&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))||!Number.isFinite(Date.parse(value)))throw new IntakeValidationError('Use a valid review date or an ISO timestamp with timezone.',row);const parsed=new Date(value);if(new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))throw new IntakeValidationError('Review date is not a calendar date.',row);return parsed.toISOString()}
const inputRow=z.object({platform:z.enum(platforms),platformReviewId:z.string().trim().max(500).nullable().optional(),reviewerName:z.string().trim().max(300).nullable().optional(),reviewerAvatarUrl:z.string().max(2048).nullable().optional(),rating:z.number().int().min(1).max(5).nullable().optional(),reviewText:z.string().trim().min(1).max(20000),reviewDate:z.string().max(50).nullable().optional()}).strict()
export function normalizeIntakeRows(values:unknown[]):{reviews:IntakeRow[];duplicateRows:number}{
 if(!values.length||values.length>INTAKE_MAX_ROWS)throw new IntakeValidationError(`Provide between 1 and ${INTAKE_MAX_ROWS} review rows.`)
 const reviews:IntakeRow[]=[],seen=new Map<string,string>();let duplicateRows=0
 values.forEach((value,i)=>{const result=inputRow.safeParse(value);if(!result.success)throw new IntakeValidationError('Check the platform, review text, rating and source identity.',i+1);const row=result.data,reviewDate=date(row.reviewDate,i+1),reviewerName=row.reviewerName||'Anonymous',fingerprint=reviewContentFingerprint({platform:row.platform,reviewerName,reviewDate:row.reviewDate??null,reviewText:row.reviewText,rating:row.rating??null}),legacyFingerprint=reviewContentFingerprint({platform:row.platform,reviewerName:row.reviewerName??null,reviewDate:row.reviewDate??null,reviewText:row.reviewText,rating:row.rating??null}),platformReviewId=row.platformReviewId||`fp-${fingerprint.slice(0,24)}`,key=`${row.platform}:${platformReviewId}`,rowHash=intakeHash(JSON.stringify([reviewerName,reviewDate,row.reviewText,row.rating??null,row.reviewerAvatarUrl??null]))
  if(seen.has(key)){if(seen.get(key)!==rowHash)throw new IntakeValidationError('This source review ID has conflicting text in the same intake. Resolve the duplicate first.',i+1);duplicateRows++;return}
  seen.set(key,rowHash);reviews.push({platform:row.platform,platformReviewId,identityBasis:row.platformReviewId?'provider_id':'content_fingerprint',reviewerName,reviewerAvatarUrl:row.reviewerAvatarUrl&&safePublicationUrl(row.reviewerAvatarUrl)?row.reviewerAvatarUrl:null,rating:row.rating??null,reviewText:row.reviewText,reviewDate,fingerprint,legacyFingerprint})
 });return{reviews,duplicateRows}
}
/** RFC-style quoted fields including escaped quotes, commas and embedded line breaks. */
export function parseReviewCsv(text:string):unknown[]{
 if(Buffer.byteLength(text,'utf8')>INTAKE_MAX_BYTES)throw new IntakeValidationError('CSV is too large. Split it into files of at most 2 MB.')
 const rows:string[][]=[];let fields:string[]=[],field='',quoted=false,closed=false
 const finishField=()=>{fields.push(field);field='';closed=false}
 const finishRow=()=>{finishField();if(fields.some(v=>v.trim()))rows.push(fields);fields=[];if(rows.length>INTAKE_MAX_ROWS+1)throw new IntakeValidationError(`CSV supports at most ${INTAKE_MAX_ROWS} review rows.`)}
 text=text.replace(/^\uFEFF/,'')
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
  if(c===','){finishField();continue}if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finishRow();continue}
  if(closed){if(c===' '||c==='\t')continue;throw new IntakeValidationError('Unexpected text after a quoted CSV field.',rows.length+1)}
  if(c==='"'){if(field.length)throw new IntakeValidationError('Quotes must enclose the entire CSV field.',rows.length+1);quoted=true}else field+=c
 }
 if(quoted)throw new IntakeValidationError('The CSV has an unclosed quoted field.',rows.length+1)
 if(field.length||fields.length||closed)finishRow()
 if(rows.length<2)throw new IntakeValidationError('CSV needs column headers and at least one review.')
 const headers=rows.shift()!.map(h=>h.trim().toLowerCase()),allowed=new Set(['platform','platform_review_id','reviewer_name','review_text','rating','review_date'])
 if(new Set(headers).size!==headers.length||headers.some(h=>!allowed.has(h))||!headers.includes('platform')||!headers.includes('review_text'))throw new IntakeValidationError('Use unique supported columns, including platform and review_text.')
 return rows.map((values,i)=>{if(values.length!==headers.length)throw new IntakeValidationError('Column count does not match the header.',i+2);const row=Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]));const rating=row.rating?(/^[1-5]$/.test(row.rating)?Number(row.rating):NaN):null;return{platform:row.platform,platformReviewId:row.platform_review_id||null,reviewerName:row.reviewer_name||null,reviewText:row.review_text,rating,reviewDate:row.review_date||null}})
}
export function parseSavedManualIntake(kind:'manual'|'csv',content:string):ParsedIntake{
 if(Buffer.byteLength(content,'utf8')>INTAKE_MAX_BYTES)throw new IntakeValidationError('Saved intake exceeds its size limit.')
 let rows:unknown[]
 if(kind==='csv')rows=parseReviewCsv(content);else{let value:unknown;try{value=JSON.parse(content)}catch{throw new IntakeValidationError('Saved manual intake is not valid JSON.')}rows=Array.isArray(value)?value:[value]}
 return{contractVersion:INTAKE_CONTRACT_VERSION,...normalizeIntakeRows(rows),retrievalMethod:kind==='csv'?'csv_import':'manual',completeness:'unknown',note:'Staff-supplied source; provider completeness has not been verified.',sourceHash:intakeHash(content)}
}
const providerReview=z.object({platform_review_id:z.string().nullable().optional(),reviewer_name:z.string().nullable().optional(),reviewer_avatar_url:z.string().nullable().optional(),rating:z.number().nullable().optional(),review_text:z.string(),review_date:z.string().nullable().optional()})
const providerOutput=z.object({success:z.literal(true),reviews:z.array(providerReview).max(INTAKE_MAX_ROWS),retrieval_method:z.enum(['provider_api','scraper']).nullable().optional(),completeness:z.enum(['complete','sample','degraded','unknown']).nullable().optional(),note:z.string().max(4000).nullable().optional()})
export function parseSavedProviderIntake(input:{platform:'google'|'yelp';method:'api'|'scraper';contractVersion:string},receipt:{status:string;httpStatus?:number;content?:string}):ParsedIntake{
 if(input.contractVersion!==INTAKE_CONTRACT_VERSION)throw new IntakeValidationError('This saved result requires its original intake parser.')
 if(receipt.status!=='received'||!receipt.httpStatus||receipt.httpStatus<200||receipt.httpStatus>299||typeof receipt.content!=='string')throw new IntakeValidationError('No successful provider result is saved.')
 if(Buffer.byteLength(receipt.content,'utf8')>INTAKE_MAX_BYTES)throw new IntakeValidationError('Provider result exceeds its size limit.')
 let raw:unknown;try{raw=JSON.parse(receipt.content)}catch{throw new IntakeValidationError('Saved provider result is not valid JSON.')}
 const parsed=providerOutput.safeParse(raw);if(!parsed.success)throw new IntakeValidationError('Saved provider result does not match its review contract.')
 const values=parsed.data.reviews.map(r=>({platform:input.platform,platformReviewId:r.platform_review_id??null,reviewerName:r.reviewer_name??null,reviewerAvatarUrl:r.reviewer_avatar_url??null,rating:r.rating??null,reviewText:r.review_text,reviewDate:r.review_date??null})),normalized=values.length?normalizeIntakeRows(values):{reviews:[],duplicateRows:0}
 return{contractVersion:INTAKE_CONTRACT_VERSION,...normalized,retrievalMethod:parsed.data.retrieval_method??(input.method==='scraper'?'scraper':'provider_api'),completeness:parsed.data.completeness==='degraded'?'degraded':input.method==='api'?'sample':parsed.data.completeness==='sample'?'sample':'unknown',note:parsed.data.note??(input.method==='api'?'The provider API returns a limited review sample.':'Collection is bounded; complete review coverage has not been verified.'),sourceHash:intakeHash(receipt.content)}
}
