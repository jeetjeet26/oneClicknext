import {NextResponse}from 'next/server'
import {invitationSession}from '@/utils/team/contracts'
import {TeamError}from '@/utils/team/store'
import {teamBody,teamFailure,requireTeamOrigin,teamHeaders as headers}from '@/utils/team/http'
export async function POST(req:Request){try{
 requireTeamOrigin(req)
 const q=invitationSession.safeParse(await teamBody(req,2048));if(!q.success)throw new TeamError('This invitation link is invalid.',400)
 const response=NextResponse.json({state:'ready'},{headers});response.cookies.set('p11_team_invitation',q.data.token,{httpOnly:true,secure:new URL(req.url).protocol==='https:',sameSite:'lax',path:'/api/team/join',maxAge:1800});return response
 }catch(e){return teamFailure(e)}}
