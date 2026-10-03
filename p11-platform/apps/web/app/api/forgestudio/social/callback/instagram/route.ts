import {NextRequest} from 'next/server'
import {completeSocialAuthorization} from '@/utils/forgestudio/oauth-flow'
export async function GET(request:NextRequest){return completeSocialAuthorization(request,'instagram')}
