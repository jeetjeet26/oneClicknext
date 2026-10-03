import {NextResponse} from 'next/server'
export async function GET(){return NextResponse.json({error:'Use /api/lumaleasing/admin/conversation-work for complete scoped inbox and transcript pages.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}
