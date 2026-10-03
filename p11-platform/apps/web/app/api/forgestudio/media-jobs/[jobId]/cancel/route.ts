import {NextResponse} from 'next/server'
import {createClient} from '@/utils/supabase/server'
export async function POST(){
 const {data:{user}}=await(await createClient()).auth.getUser()
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
 return NextResponse.json({error:'Open the saved media request to stop its exact current version and record your reason.'},{status:409})
}
