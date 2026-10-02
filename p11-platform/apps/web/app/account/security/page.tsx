import Link from 'next/link'
import {redirect} from 'next/navigation'
import {createClient} from '@/utils/supabase/server'
import {AccountPassword} from '@/components/settings/AccountPassword'
import {AccountSessions} from '@/components/settings/AccountSessions'
export const metadata={title:'Account security',referrer:'no-referrer',robots:{index:false,follow:false}}
export default async function AccountSecurityPage(){const{data:{user}}=await(await createClient()).auth.getUser();if(!user)redirect('/auth/login?redirect=%2Faccount%2Fsecurity');return<main className="mx-auto max-w-3xl space-y-5 p-5"><Link href="/dashboard/profile" className="text-sm underline">Back to your account</Link><h1 className="text-2xl font-semibold">Account security</h1><AccountPassword key={user.id+':password'} actorId={user.id}/><AccountSessions key={user.id} actorId={user.id}/></main>}
