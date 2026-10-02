import {NextResponse} from 'next/server'
import {getAppBaseUrl} from '@/utils/services/runtime-config'
/** Pre-ledger callbacks cannot prove the connection snapshot they would replace. */
export async function GET(){
 const url=new URL('/dashboard/lumaleasing',getAppBaseUrl());url.searchParams.set('error','expired_state')
 return NextResponse.redirect(url,{headers:{'Cache-Control':'no-store'}})
}
