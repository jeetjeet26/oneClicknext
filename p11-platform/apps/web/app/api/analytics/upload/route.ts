import {NextResponse} from 'next/server'
import {teamHeaders as headers} from '@/utils/team/http'
const retired=()=>NextResponse.json({error:'Open CSV imports in MultiChannel BI to prepare, inspect and apply a saved preview.'},{status:410,headers})
export async function POST(){return retired()}
export async function GET(){return retired()}
