import {NextResponse} from 'next/server'
import {sessionActor} from '@/utils/account-sessions/server'
import {credentialCommand,credentialQuery} from '@/utils/account-credentials/contracts'
import {executeCredential,readCredentials,CredentialError} from '@/utils/account-credentials/store'
import {verifyCurrentPassword} from '@/utils/account-credentials/provider'
import {teamBody,requireTeamOrigin,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof CredentialError?e.message:'Password controls are unavailable. Check the saved request before retrying.'},{status:e instanceof CredentialError?e.status:503,headers})}
export async function GET(req:Request){try{const{actor}=await sessionActor(),q=credentialQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!q.success)throw new CredentialError('Choose your account security history.',400);return NextResponse.json(await readCredentials(actor,q.data),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{requireTeamOrigin(req);const context=await sessionActor(),q=credentialCommand.safeParse(await teamBody(req,8192));if(!q.success)throw new CredentialError('Provide your current password and a different new password of at least eight characters.',400);if(!context.email)throw new CredentialError('A verified email account is required for this password change.',409);const r=await executeCredential(context.actor,q.data,{verify:password=>verifyCurrentPassword(context.actor.actorId,context.email!,password),change:context.changePassword});return NextResponse.json(r,{headers})}catch(e){return failure(e)}}
