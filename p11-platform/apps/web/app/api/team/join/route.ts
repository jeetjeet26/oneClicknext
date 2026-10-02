import {cookies}from 'next/headers'
import {NextResponse}from 'next/server'
import {joinCommand,joinQuery}from '@/utils/team/contracts'
import {teamActor,TeamError,readTeamJoin,decideTeamJoin}from '@/utils/team/store'
import {teamBody,teamFailure,requireTeamOrigin,teamHeaders as headers}from '@/utils/team/http'
const token=async()=>(await cookies()).get('p11_team_invitation')?.value||null
export async function GET(req:Request){try{const actor=await teamActor(),q=joinQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!q.success)throw new TeamError('Choose the saved invitation decision.',400);return NextResponse.json(await readTeamJoin(actor,await token(),q.data.decisionId),{headers})}catch(e){return teamFailure(e)}}
export async function POST(req:Request){try{const actor=await teamActor();requireTeamOrigin(req);const q=joinCommand.safeParse(await teamBody(req));if(!q.success)throw new TeamError('Review and confirm this exact invitation.',400);const result=await decideTeamJoin(actor,await token(),q.data);const response=NextResponse.json(result,{headers});if(!result.cancelled)response.cookies.set('p11_team_invitation','',{httpOnly:true,secure:new URL(req.url).protocol==='https:',sameSite:'lax',path:'/api/team/join',maxAge:0});return response}catch(e){return teamFailure(e)}}
