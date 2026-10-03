import {NextRequest,NextResponse} from 'next/server'
import {normalizeProvider} from '@/utils/services/integration-provider-config'
export async function GET(request:NextRequest){
 const propertyId=request.nextUrl.searchParams.get('propertyId'),provider=normalizeProvider(request.nextUrl.searchParams.get('provider')||'google')
 if(!propertyId||!provider)return NextResponse.json({error:'A property and supported provider are required.'},{status:400})
 const url=new URL(`/api/lumaleasing/integrations/oauth/${provider}/start`,request.url)
 url.searchParams.set('propertyId',propertyId);url.searchParams.set('capabilities','calendar')
 return NextResponse.redirect(url,{headers:{'Cache-Control':'no-store'}})
}
