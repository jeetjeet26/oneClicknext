import {NextResponse} from 'next/server'
// One property-scoped, paged read contract. Credentials are never part of checklist status.
export {GET} from '@/app/api/community/tasks/route'
export async function PATCH(){return NextResponse.json({error:'Use the reviewed property checklist to record this change.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}
