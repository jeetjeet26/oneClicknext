'use client'
import {useState} from 'react'
import Link from 'next/link'
import {User,Shield} from 'lucide-react'
import {AccountSettingsWorkbench} from '@/components/settings/AccountSettingsWorkbench'
import {AccountPassword} from '@/components/settings/AccountPassword'
import {useAccountActor} from '@/components/layout/AccountPreferences'
export default function ProfilePage(){
 const [section,setSection]=useState<'profile'|'security'>('profile')
 const actor=useAccountActor()
 return<div className="space-y-6 text-foreground"><div><h1 className="text-2xl font-bold">Profile</h1><p className="text-muted-foreground">Manage your personal information and security settings</p></div><div className="flex flex-col gap-6 lg:flex-row"><nav className="h-fit rounded-xl border border-border bg-card p-2 lg:w-56">{[{id:'profile' as const,label:'Profile',icon:User},{id:'security' as const,label:'Security',icon:Shield}].map(s=><button key={s.id} className={'flex w-full items-center gap-2 rounded-lg p-3 text-left '+(section===s.id?'bg-muted font-medium':'')} onClick={()=>setSection(s.id)}><s.icon size={18}/>{s.label}</button>)}</nav><div className="min-w-0 flex-1 space-y-5">{section==='profile'?<AccountSettingsWorkbench section="personal"/>:<><AccountPassword key={actor} actorId={actor}/><div className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Active sessions</h2><p className="mt-1 text-sm text-muted-foreground">Review actual sessions and saved sign-out requests.</p><Link href="/account/security" className="mt-3 inline-block text-sm underline">View Sessions</Link></div></>}</div></div></div>
}
