import {z}from 'zod'
import {profileSchema,propertyIdSchema,type SetupSnapshot,type PropertyProfile}from './contracts'
import {normalizePublicWebsiteUrl}from '@/utils/services/public-url'
export const templateFlagsSchema=z.object({contacts:z.boolean(),connections:z.boolean(),guidance:z.boolean()}).strict()
export const templateSelectionSchema=z.object({sourceId:propertyIdSchema,snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),flags:templateFlagsSchema,guidanceConfirmed:z.boolean()}).strict().refine(v=>!v.flags.guidance||v.guidanceConfirmed,'Confirm copied guidance applies to the new property.')
export const creationSchema=z.object({requestId:propertyIdSchema,profile:profileSchema,template:templateSelectionSchema.nullable()}).strict()
export type TemplateFlags=z.infer<typeof templateFlagsSchema>
export type TemplateSelection=z.infer<typeof templateSelectionSchema>
export type TemplateSnapshot={sourcePropertyId:string;sourceName:string;flags:TemplateFlags;contacts:SetupSnapshot['contacts'];connectionRequests:SetupSnapshot['connectionRequests'];guidance:{brandVoice:string;targetAudience:string;petPolicy:unknown;parkingInfo:unknown;officeHours:unknown}|null}
export type TemplatePreview={state:'ready';sourceId:string;snapshot:TemplateSnapshot;snapshotHash:string}
export type CreationReceipt={state:'created'|'replayed'|'ready';requestId:string;propertyId:string;property:Record<string,unknown>&{id:string;name:string;onboarding_completed_at:string|null};snapshot:SetupSnapshot;snapshotHash:string;template:TemplateSnapshot|null;createdAt:string}
type InitialCommunity={name:string;type?:string|null;address?:{street?:string|null;city?:string|null;state?:string|null;zip?:string|null}|null;websiteUrl?:string|null;additionalUrls?:string[];unitCount?:string|number|null;yearBuilt?:string|number|null;amenities?:string[]}
export function creationProfile(c:InitialCommunity):PropertyProfile{function url(v:string){const normalized=normalizePublicWebsiteUrl(v);if(v.trim()&&!normalized)throw new Error('Review the website address before continuing.');return normalized||''}return{name:c.name.trim(),propertyType:c.type||null,address:{street:c.address?.street||'',city:c.address?.city||'',state:c.address?.state||'',zip:c.address?.zip||''},websiteUrl:url(c.websiteUrl||''),additionalUrls:(c.additionalUrls||[]).map(v=>v.trim()).filter(Boolean).map(url),unitCount:c.unitCount===''||c.unitCount==null?null:Number(c.unitCount),yearBuilt:c.yearBuilt===''||c.yearBuilt==null?null:Number(c.yearBuilt),amenities:c.amenities||[],specialFeatures:[],brandVoice:'',targetAudience:''}}

export type {PropertyProfile}from './contracts'
