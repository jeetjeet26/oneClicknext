import {NextResponse}from 'next/server'
import {z}from 'zod'
import {propertyIdSchema}from '@/utils/property-setup/contracts'
import {templateFlagsSchema}from '@/utils/property-setup/creation-contracts'
import {requireCreationActor,creationRpc}from '@/utils/property-setup/creation-store'
import {PropertySetupError}from '@/utils/property-setup/store'
export async function POST(req:Request){const headers={'Cache-Control':'private, no-store'};try{const actor=await requireCreationActor();const parsed=z.object({sourceId:propertyIdSchema,flags:templateFlagsSchema}).strict().safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Select a source and exact template sections.'},{status:400,headers});return NextResponse.json(await creationRpc('read_property_creation_template',{p_source_property:parsed.data.sourceId,p_actor_id:actor,p_flags:parsed.data.flags}),{headers})}catch(e){return NextResponse.json({error:e instanceof PropertySetupError?e.message:'The template is unavailable.'},{status:e instanceof PropertySetupError?e.status:503,headers})}}
