import { NextResponse } from 'next/server';
export async function POST() { return NextResponse.json({ error: 'Use reviewed audit decisions. Saved questions, results and source evidence are retained.' }, { status: 410 }); }
export async function PATCH() { return NextResponse.json({ error: 'Use reviewed audit decisions. Saved questions, results and source evidence are retained.' }, { status: 410 }); }
