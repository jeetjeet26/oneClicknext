import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validatePropertyAccess } from '@/utils/services/auth-guard';

/**
 * POST /api/marketvision/import
 * 
 * Triggers marketing data import for a property.
 * Creates import job and triggers Data Engine sync.
 */
export async function POST(request: NextRequest) {
  // #region agent log
  const logUrl = 'http://127.0.0.1:7242/ingest/63d68c0c-bf60-432a-9849-1fe55b783323';
  const log = (msg: string, data: Record<string, unknown>, hId: string) => fetch(logUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'import/route.ts:POST',message:msg,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId:hId})}).catch(()=>{});
  // #endregion

  // #region agent log
  await log('POST handler entry', { hasRequest: !!request }, 'H2');
  // #endregion

  const supabase = await createClient();
  
  // #region agent log
  await log('Supabase client created', { hasAuth: !!supabase?.auth }, 'H2');
  // #endregion
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  // #region agent log
  await log('Auth result', { hasUser: !!user, authError: authError?.message || null }, 'H2');
  // #endregion
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { property_id, channels, date_range } = body;

    // #region agent log
    await log('Request body parsed', { property_id, channels, date_range }, 'H1');
    // #endregion

    if (!property_id) {
      return NextResponse.json(
        { error: 'property_id is required' },
        { status: 400 }
      );
    }

    const access = await validatePropertyAccess(user.id, property_id);
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Trigger Data Engine sync
    const dataEngineUrl = process.env.DATA_ENGINE_URL || 'http://localhost:8000';
    const apiKey = process.env.DATA_ENGINE_API_KEY;

    // #region agent log
    await log('Calling Data Engine', { dataEngineUrl, hasApiKey: !!apiKey }, 'H1');
    // #endregion

    let response: Response;
    try {
      response = await fetch(`${dataEngineUrl}/sync-marketing-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          property_id,
          channels: channels || ['google_ads', 'meta_ads'],
          date_range: date_range || 'LAST_7_DAYS',
        }),
      });
    } catch (fetchError) {
      // #region agent log
      await log('Data Engine fetch failed', { error: String(fetchError) }, 'H1');
      // #endregion
      return NextResponse.json(
        { error: 'Data Engine is not reachable. Is it running?' },
        { status: 503 }
      );
    }

    // #region agent log
    await log('Data Engine response', { status: response.status, ok: response.ok }, 'H3');
    // #endregion

    const responseText = await response.text();
    
    // #region agent log
    await log('Response text', { length: responseText.length, preview: responseText.slice(0, 200) }, 'H4');
    // #endregion

    if (!responseText) {
      return NextResponse.json(
        { error: 'Data Engine returned empty response' },
        { status: 502 }
      );
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      // #region agent log
      await log('JSON parse failed', { responseText: responseText.slice(0, 500) }, 'H4');
      // #endregion
      return NextResponse.json(
        { error: 'Data Engine returned invalid JSON' },
        { status: 502 }
      );
    }

    if (!response.ok) {
      throw new Error(result.detail || 'Failed to trigger import');
    }

    // #region agent log
    await log('Import successful', { job_id: result.job_id }, 'H3');
    // #endregion

    return NextResponse.json({
      success: true,
      job_id: result.job_id,
      message: 'Import started successfully',
    });

  } catch (error) {
    // #region agent log
    await log('Catch block error', { error: String(error) }, 'H5');
    // #endregion
    console.error('Import trigger error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start import' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/marketvision/import?job_id=xxx
 * 
 * Get import job status
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('job_id');
    const propertyId = searchParams.get('property_id');

    if (!jobId && !propertyId) {
      return NextResponse.json(
        { error: 'job_id or property_id is required' },
        { status: 400 }
      );
    }

    if (propertyId) {
      const access = await validatePropertyAccess(user.id, propertyId);
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    let data, error;
    let scopedPropertyId = propertyId;

    if (jobId) {
      const result = await supabase
        .from('import_jobs')
        .select('*')
        .eq('id', jobId)
        .single();
      data = result.data;
      error = result.error;

      if (!propertyId) {
        scopedPropertyId = (result.data as { property_id?: string | null } | null)?.property_id ?? null;
      }
    } else if (propertyId) {
      const result = await supabase
        .from('import_jobs')
        .select('*')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(10);
      data = result.data;
      error = result.error;
    }

    if (!propertyId) {
      if (typeof scopedPropertyId !== 'string') {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      const access = await validatePropertyAccess(user.id, scopedPropertyId);
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ job: data });

  } catch (error) {
    console.error('Get import job error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get job status' },
      { status: 500 }
    );
  }
}






