import {NextResponse} from 'next/server'
import {z} from 'zod'
import {conversationActor,conversationRpc,InventoryError} from '@/utils/lumaleasing/conversation-store'
import {teamHeaders as headers} from '@/utils/team/http'
const query=z.object({propertyId:z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)}).strict()
export async function GET(req:Request){try{const parsed=query.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!parsed.success)throw new InventoryError('Choose a valid property.',400);const{propertyId}=parsed.data,actorId=await conversationActor(propertyId);return NextResponse.json(await conversationRpc('read_luma_overview',{p_actor_id:actorId,p_property_id:propertyId}),{headers})}catch(e){return NextResponse.json({error:e instanceof InventoryError?e.message:'The complete overview could not be loaded. Try again.'},{status:e instanceof InventoryError?e.status:503,headers})}}
