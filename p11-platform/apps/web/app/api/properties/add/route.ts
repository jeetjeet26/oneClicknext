import {NextResponse}from 'next/server'
import {creationSchema}from '@/utils/property-setup/creation-contracts'
import {requireCreationActor,creationRpc}from '@/utils/property-setup/creation-store'
import {PropertySetupError}from '@/utils/property-setup/store'
export{GET}from '../route'
export async function POST(req:Request){const headers={'Cache-Control':'private, no-store'};try{const actor=await requireCreationActor();let body:unknown;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid property creation request.'},{status:400,headers})}const parsed=creationSchema.safeParse(body);if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||'Review the property creation request.'},{status:400,headers});const{requestId,...input}=parsed.data;return NextResponse.json(await creationRpc('create_property_from_setup',{p_id:requestId,p_actor_id:actor,p_input:input}),{headers})}catch(e){return NextResponse.json({error:e instanceof PropertySetupError?e.message:'Property creation is unavailable.'},{status:e instanceof PropertySetupError?e.status:503,headers})}}
