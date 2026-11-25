import { NextResponse } from 'next/server';

export async function POST() { return NextResponse.json({ error: 'Open Pipelines to review accounts and record this import.', next: '/dashboard/pipelines' }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } }); }
