import {NextResponse}from 'next/server'
export async function POST(){return NextResponse.json({error:'This legacy chat route is retired. Use the LumaLeasing visitor widget or the recorded conversation inbox.'},{status:410,headers:{'Cache-Control':'no-store'}})}
