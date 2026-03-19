import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { normalizeMarketingChannels } from '@/utils/analytics/channel-identity';
import { normalizeImportJobRecord } from '@/utils/marketvision/import-job-state';
import { getDataEngineUrl } from '@/utils/services/runtime-config';

/**
 * POST /api/marketvision/import
 * 
 * Triggers marketing data import for a property.
 * Creates import job and triggers Data Engine sync.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { property_id, channels, date_range } = body;
    const normalizedChannels = normalizeMarketingChannels(channels || ['google_ads', 'meta_ads']);
    const requestedChannels = normalizedChannels.length > 0 ? normalizedChannels : ['google_ads', 'meta_ads'];

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
    const dataEngineUrl = getDataEngineUrl();
    const apiKey = process.env.DATA_ENGINE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'DATA_ENGINE_API_KEY is required to trigger MarketVision imports.' },
        { status: 500 }
      );
    }

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
          channels: requestedChannels,
          date_range: date_range || 'LAST_7_DAYS',
        }),
      });
    } catch (fetchError) {
      return NextResponse.json(
        {
          error: 'Data Engine is not reachable. Is it running?',
          details: fetchError instanceof Error ? fetchError.message : String(fetchError),
        },
        { status: 503 }
      );
    }

    const responseText = await response.text();

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
      return NextResponse.json(
        { error: 'Data Engine returned invalid JSON' },
        { status: 502 }
      );
    }

    if (!response.ok) {
      throw new Error(result.detail || 'Failed to trigger import');
    }

    return NextResponse.json({
      success: true,
      job_id: result.job_id,
      message: 'Import started successfully',
    });

  } catch (error) {
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

    if (Array.isArray(data)) {
      return NextResponse.json({ job: data.map((item) => normalizeImportJobRecord(item)) });
    }

    if (data && typeof data === 'object') {
      return NextResponse.json({ job: normalizeImportJobRecord(data) });
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






