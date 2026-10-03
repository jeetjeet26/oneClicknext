import {NextResponse}from 'next/server'
import {teamCommand,teamQuery}from '@/utils/team/contracts'
import {teamActor,TeamError,currentTeamOrganization,readTeam,decideTeam}from '@/utils/team/store'
import {teamBody,teamFailure,requireTeamOrigin,teamHeaders as headers}from '@/utils/team/http'
export async function GET(req:Request){try{const actor=await teamActor(),q=teamQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!q.success)throw new TeamError('Choose a team member or saved decision.',400);const{orgId,...input}=q.data;return NextResponse.json(await readTeam(actor,orgId||await currentTeamOrganization(actor),input),{headers})}catch(e){return teamFailure(e)}}
export async function POST(req:Request){try{const actor=await teamActor();requireTeamOrigin(req);const q=teamCommand.safeParse(await teamBody(req));if(!q.success)throw new TeamError(q.error.issues[0]?.message||'Review the team decision.',400);return NextResponse.json(await decideTeam(actor,q.data),{headers})}catch(e){return teamFailure(e)}}
export async function PATCH(){return NextResponse.json({error:'Review the exact member and roster using the recorded team decision.'},{status:410,headers})}
export async function DELETE(){return NextResponse.json({error:'Review the exact member before removing organization access.'},{status:410,headers})}
