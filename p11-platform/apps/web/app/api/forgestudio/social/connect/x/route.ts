import {NextRequest} from 'next/server'
import {beginSocialAuthorization} from '@/utils/forgestudio/oauth-flow'
export async function GET(request:NextRequest){return beginSocialAuthorization(request,'x')}
