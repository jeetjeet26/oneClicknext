import {z} from 'zod'
import {PROPERTY_TYPE_VALUES} from '@/utils/property-types'
export const marketId=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
const version=z.number().int().positive(),reason=z.string().trim().min(3).max(2000)
export function publicMarketUrl(value:string){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!u.port||['80','443'].includes(u.port))&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(u.hostname)&&!/(^|\.)(localhost|local|internal|test)$/i.test(u.hostname)}catch{return false}}
const text=(max:number)=>z.string().trim().max(max).nullable()
const url=z.string().trim().max(2000).refine(publicMarketUrl,'Use a public website URL without credentials').nullable()
const integer=(max:number)=>z.number().int().min(0).max(max).nullable()
const money=z.number().min(0).max(99999999.99).multipleOf(0.01).nullable()
export const unitValues=z.object({unit_type:z.string().trim().min(1).max(100),bedrooms:z.number().int().min(0).max(20),bathrooms:z.number().min(0).max(20).multipleOf(0.1).nullable(),sqft_min:integer(1000000),sqft_max:integer(1000000),rent_min:money,rent_max:money,deposit:money,available_count:integer(1000000),move_in_specials:text(5000)}).strict().refine(v=>v.sqft_min===null||v.sqft_max===null||v.sqft_min<=v.sqft_max,'Minimum area cannot exceed maximum').refine(v=>v.rent_min===null||v.rent_max===null||v.rent_min<=v.rent_max,'Minimum price cannot exceed maximum')
export const competitorValues=z.object({name:z.string().trim().min(1).max(200),address:text(2000),website_url:url,phone:text(100),units_count:integer(1000000),year_built:z.number().int().min(1000).max(2200).nullable(),property_type:z.enum(PROPERTY_TYPE_VALUES),amenities:z.array(z.string().trim().min(1).max(200)).max(100),notes:text(10000)}).strict()
const common={requestId:marketId,propertyId:marketId,reason}
export const competitorDecision=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('create'),values:competitorValues,units:z.array(unitValues).max(100)}).strict(),
 z.object({...common,action:z.literal('save'),competitorId:marketId,expectedVersion:version,values:competitorValues}).strict(),
 z.object({...common,action:z.enum(['archive','restore']),competitorId:marketId,expectedVersion:version}).strict()
])
export const unitDecision=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('create'),competitorId:marketId,values:unitValues}).strict(),
 z.object({...common,action:z.literal('save'),competitorId:marketId,unitId:marketId,expectedVersion:version,values:unitValues}).strict(),
 z.object({...common,action:z.literal('remove'),competitorId:marketId,unitId:marketId,expectedVersion:version}).strict()
])
export const configurationDecision=z.object({...common,expectedVersion:z.number().int().min(0),values:z.object({is_enabled:z.boolean(),scrape_frequency:z.enum(['daily','weekly','manual']),radius_miles:z.number().min(0.5).max(25),max_competitors:z.number().int().min(1).max(100),auto_add:z.boolean()}).strict()}).strict()
export const historyRead=z.object({propertyId:marketId,resourceId:marketId.optional(),cursor:marketId.optional()}).strict()
