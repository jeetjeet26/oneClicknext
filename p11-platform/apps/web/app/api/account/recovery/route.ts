import {NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {sessionActor} from '@/utils/account-sessions/server'
import {readCredentials,CredentialError} from '@/utils/account-credentials/store'
import {teamBody,requireTeamOrigin,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof CredentialError?e.message:'Recovery could not be verified. Request a new link, or reload to check a session already opened.'},{status:e instanceof CredentialError?e.status:503,headers})}
export async function GET(){try{const{actor}=await sessionActor();return NextResponse.json(await readCredentials(actor),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{requireTeamOrigin(req);const input=z.object({code:z.string().min(1).max(2048)}).strict().safeParse(await teamBody(req,4096));if(!input.success)throw new CredentialError('Use the recovery link from your email.',400);const client=await createClient({userAgent:req.headers.get('user-agent')}),result=await client.auth.exchangeCodeForSession(input.data.code);if(result.error)throw new CredentialError('This link is invalid, expired, already opened, or belongs to another browser. Request a new link, or reload to check an already opened session.',409);const{actor}=await sessionActor();return NextResponse.json(await readCredentials(actor),{headers})}catch(e){return failure(e)}}
