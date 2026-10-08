import { after,NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTeamOrigin,teamBody } from '@/utils/team/http'
import { requirePackageOperator } from '@/utils/siteforge/packages/store'
import { deliveryView,requestDelivery,executeDelivery,reconcileDelivery } from '@/utils/siteforge/packages/delivery'
import { InventoryError } from '@/utils/knowledge/inventory'
import { PackageError } from '@/utils/siteforge/packages/contracts'
export const maxDuration=300
const headers={'Cache-Control':'private, no-store'}
const command=z.object({requestId:z.uuid(),propertyId:z.guid(),jobId:z.uuid(),targetId:z.uuid(),kind:z.enum(['preview','approve','deploy']),previewId:z.uuid().optional(),approvalId:z.uuid().optional(),confirmed:z.literal(true)}).strict()
function failure(e:unknown){return NextResponse.json({error:(e instanceof PackageError||e instanceof InventoryError)?e.message:e instanceof z.ZodError?'Review the website, destination and confirmation.':'Website delivery could not be confirmed. Refresh to check its saved status.'},{status:(e instanceof PackageError||e instanceof InventoryError)?e.status:e instanceof z.ZodError?400:503,headers})}
export async function GET(req:NextRequest){try{const id=z.guid().parse(req.nextUrl.searchParams.get('propertyId'));await requirePackageOperator(id);return NextResponse.json(await deliveryView(id),{headers})}catch(e){return failure(e)}}
export async function POST(req:NextRequest){try{requireTeamOrigin(req);const input=command.parse(await teamBody(req));const actor=await requirePackageOperator(input.propertyId);const result=await requestDelivery(input,actor);if(result.created&&result.state==='running')after(()=>executeDelivery(result.id));return NextResponse.json(result,{status:result.state==='running'?202:200,headers})}catch(e){return failure(e)}}

export async function PATCH(req:NextRequest){try{requireTeamOrigin(req);const input=z.object({propertyId:z.guid(),releaseId:z.uuid()}).strict().parse(await teamBody(req));const actor=await requirePackageOperator(input.propertyId);return NextResponse.json(await reconcileDelivery(input.releaseId,input.propertyId,actor),{headers})}catch(e){return failure(e)}}
