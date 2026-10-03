import {NextResponse} from 'next/server'
export async function POST(){return NextResponse.json({error:'Prepare and review a saved evaluation from the audit run before applying changed scores.'},{status:410})}
