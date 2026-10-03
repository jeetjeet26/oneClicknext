import {NextResponse}from 'next/server'
import {z}from 'zod'
import {propertyIdSchema}from '@/utils/property-setup/contracts'
import {requireCreationActor,creationRpc}from '@/utils/property-setup/creation-store'
import {PropertySetupError}from '@/utils/property-setup/store'
export async function GET(req:Request){const headers={'Cache-Control':'private, no-store'};try{const actor=await requireCreationActor();const parsed=z.object({requestId:propertyIdSchema}).strict().safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)return NextResponse.json({error:'Invalid creation identity.'},{status:400,headers});return NextResponse.json(await creationRpc('read_property_creation',{p_id:parsed.data.requestId,p_actor_id:actor}),{headers})}catch(e){return NextResponse.json({error:e instanceof PropertySetupError?e.message:'Creation recovery is unavailable.'},{status:e instanceof PropertySetupError?e.status:503,headers})}}
