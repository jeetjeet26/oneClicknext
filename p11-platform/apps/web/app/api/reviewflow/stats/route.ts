import {NextRequest} from 'next/server'
import {readOverview} from '@/utils/reviewflow/overview-api'
export const GET=(request:NextRequest)=>readOverview(request,'stats')
