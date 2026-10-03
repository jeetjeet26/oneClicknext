'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {AccountPassword} from '@/components/settings/AccountPassword'
import {credentialFetch} from '@/utils/account-credentials/client'
import type {CredentialSource} from '@/utils/account-credentials/contracts'
export default function ResetPasswordPage(){
 const started=useRef(false),[source,setSource]=useState<CredentialSource|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{if(started.current)return;started.current=true;const code=new URL(window.location.href).searchParams.get('code');window.history.replaceState(null,'','/auth/reset-password');
 void credentialFetch('/api/account/recovery',code?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})}:undefined).then(setSource).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[])
 return <main className="mx-auto max-w-xl space-y-5 px-4 py-12"><h1 className="text-2xl font-semibold">Account recovery</h1><p>Open the email link in the same browser where you requested it.</p>{loading&&<p role="status">Verifying recovery session…</p>}{error&&<p role="alert">{error}</p>}{source&&<AccountPassword actorId={source.actorId} recovery/>}<div className="flex flex-wrap gap-4 text-sm underline"><Link href="/auth/forgot-password">Request a new recovery link</Link><Link href="/account/security">Account security</Link><Link href="/auth/login?reauth=1">Sign in</Link></div></main>
}
