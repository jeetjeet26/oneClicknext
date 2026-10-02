import type {Metadata} from 'next'
import {readIntegrationInviteLink} from '@/utils/services/integration-auth-invites'
export const metadata:Metadata={title:'Authorize account access',robots:{index:false,follow:false},referrer:'no-referrer'}
export default async function IntegrationConnectPage({searchParams}:{searchParams:Promise<{token?:string|string[]}>}) {
 const params=await searchParams,token=typeof params.token==='string'?params.token:''
 let invite:Awaited<ReturnType<typeof readIntegrationInviteLink>>=null,unavailable=false
 try{invite=await readIntegrationInviteLink(token)}catch{unavailable=true}
 const access=invite?.capabilities.join(' and '),provider=invite?.provider==='microsoft'?'Microsoft':'Google'
 const messages:Record<string,string>={used:'This link has already been used. Your P11 contact can manage the connected account.',revoked:'Your P11 contact revoked this link. Ask them for a new link if access is still needed.',expired:'This link has expired. Ask your P11 contact for a new link.'}
 return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4"><section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-600">P11 LumaLeasing</p><h1 className="mb-3 text-2xl font-bold text-slate-900">Authorize account access</h1>
  {unavailable?<div role="alert" className="space-y-3 text-sm text-amber-800"><p>We could not check this authorization link. Try again shortly.</p><a className="underline" href={`/lumaleasing/integrations/connect?token=${encodeURIComponent(token)}`}>Retry link status</a></div>:!invite?<p role="alert" className="text-sm text-red-700">This authorization link is invalid or missing. Ask your P11 contact for a new link.</p>:<div className="space-y-4">
   <p className="text-sm text-slate-700">{provider} {access} access for <strong>{invite.propertyName}</strong>.</p>
   {invite.state==='pending'?<><p className="text-sm text-slate-600">Connect the requested account to this property. This does not create a console login.</p><a href={`/api/lumaleasing/integrations/oauth/${invite.provider}/start?token=${encodeURIComponent(token)}`} className="block rounded-lg bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white">Continue with {provider}</a><p className="text-xs text-slate-500">Expires {new Date(invite.expiresAt).toLocaleString('en-US',{timeZone:'UTC'})} UTC. Your organization may require an administrator to approve access.</p></>:<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{messages[invite.state]}</p>}
  </div>}
 </section></main>
}
