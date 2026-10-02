import {z} from 'zod'
export const studioConfigurationSchema=z.object({
 brand_voice:z.string().trim().max(2000).nullable(),
 target_audience:z.string().trim().max(1000).nullable(),
 key_amenities:z.array(z.string().trim().min(1).max(120)).max(30),
 include_hashtags:z.boolean(),include_cta:z.boolean(),max_caption_length:z.number().int().min(50).max(10000),
}).strict()
export type StudioConfiguration=z.infer<typeof studioConfigurationSchema>
export const defaultStudioConfiguration:StudioConfiguration={brand_voice:null,target_audience:null,key_amenities:[],include_hashtags:true,include_cta:true,max_caption_length:2200}
export function studioConfigurationValue(row:{[K in keyof StudioConfiguration]?:StudioConfiguration[K]|null}|null):StudioConfiguration{
 return Object.fromEntries(Object.entries(defaultStudioConfiguration).map(([key,value])=>[key,row?.[key as keyof StudioConfiguration]??value])) as StudioConfiguration
}
