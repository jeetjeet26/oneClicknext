import {createClient}from '@/utils/supabase/server'
import {TeamJoinWorkbench}from '@/components/team/TeamJoinWorkbench'
export const metadata={title:'Review team invitation',referrer:'no-referrer',robots:{index:false,follow:false}}
export default async function TeamJoinPage(){const{data:{user}}=await(await createClient()).auth.getUser();return<TeamJoinWorkbench actorId={user?.id||null}/>}
