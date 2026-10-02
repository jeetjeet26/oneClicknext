import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ error: 'Open Reports & exports in PropertyAudit to save and retrieve a report from retained evidence.' }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } }); }
