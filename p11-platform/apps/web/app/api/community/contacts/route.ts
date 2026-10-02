import {NextRequest,NextResponse}from 'next/server'
import {createClient}from '@/utils/supabase/server'
import {requireSetupActor,setupRpc,PropertySetupError}from '@/utils/property-setup/store'
import {propertyIdSchema,type SetupSnapshot}from '@/utils/property-setup/contracts'
export async function GET(request:NextRequest){const headers={'Cache-Control':'private, no-store'};try{const id=request.nextUrl.searchParams.get('propertyId')||'',actor=await requireSetupActor(id);if(!propertyIdSchema.safeParse(id).success)return NextResponse.json({error:'Invalid property identity.'},{status:400,headers});const r=await setupRpc('read_property_setup',{p_property_id:id,p_actor_id:actor}),snapshot=r.snapshot as SetupSnapshot;return NextResponse.json({contacts:snapshot.contacts.map(c=>({id:c.id,property_id:id,contact_type:c.type,name:c.name,email:c.email,phone:c.phone,role:c.role,billing_address:c.billingAddress,billing_method:c.billingMethod,special_instructions:c.specialInstructions,needs_w9:c.needsW9,is_primary:c.isPrimary}))},{headers})}catch(e){return NextResponse.json({error:e instanceof PropertySetupError?e.message:'Property contacts are unavailable.'},{status:e instanceof PropertySetupError?e.status:503,headers})}}
async function retiredWrite() {
 const {data:{user},error}=await(await createClient()).auth.getUser()
 return NextResponse.json({error:error||!user?'Unauthorized':'Open Edit Contacts to review and save contacts with property history.'},{status:error||!user?401:410,headers:{'Cache-Control':'private, no-store'}})
}
export const POST=retiredWrite
export const PUT=retiredWrite
export const DELETE=retiredWrite
