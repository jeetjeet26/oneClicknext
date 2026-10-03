import {NextResponse} from 'next/server'
export async function POST(){return NextResponse.json({error:'Use the reviewed asset library and select its exact logo from Configuration.'},{status:410,headers:{'Cache-Control':'no-store'}})}
