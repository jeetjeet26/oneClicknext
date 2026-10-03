import {NextResponse} from 'next/server'
import {sessionCommand,sessionQuery} from '@/utils/account-sessions/contracts'
import {sessionActor,clearSessionCookies} from '@/utils/account-sessions/server'
import {readSessions,executeSessionDecision,SessionError} from '@/utils/account-sessions/store'
import {teamBody,requireTeamOrigin,teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof SessionError?e.message:'Session controls are unavailable. Check your saved request before retrying.'},{status:e instanceof SessionError?e.status:503,headers})}
export async function GET(req:Request){try{const {actor}=await sessionActor(),q=sessionQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!q.success)throw new SessionError('Choose your current sessions or a saved request.',400);return NextResponse.json(await readSessions(actor,q.data),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{requireTeamOrigin(req);const {actor,provider}=await sessionActor(),q=sessionCommand.safeParse(await teamBody(req,4096));if(!q.success)throw new SessionError('Review the exact session decision.',400);const result=await executeSessionDecision(actor,q.data,provider);if(q.data.operation==='revoke'&&q.data.scope==='local'&&result.status==='acknowledged')await clearSessionCookies();return NextResponse.json(result,{headers})}catch(e){return failure(e)}}
