import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { NextRequest, NextResponse } from 'next/server'
import { 
  parseMarketingCSV, 
  parseExtendedReport,
  type MarketingPlatform,
  type ParsedMarketingRow,
  type ExtendedMetricsRow
} from '@/utils/csv/marketing-csv-parser'
import { normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

export const maxDuration = 60 // Allow up to 60 seconds for large files

type UploadRequest = {
  csvContent: string
  filename: string
  campaignName: string
  propertyId: string
  platform: MarketingPlatform
  preview?: boolean // If true, just parse and return preview without saving
}

type PreviewData = {
  rows: ParsedMarketingRow[] | ExtendedMetricsRow[]
  dateRange: { start: string; end: string } | null
  platform: MarketingPlatform
  reportType: string
  totalRows: number
  isExtended: boolean
  totals: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
  }
}

type UploadResponse = {
  success: boolean
  message: string
  preview?: PreviewData
  imported?: {
    rowCount: number
    dateRange: { start: string; end: string } | null
    reportType: string
    isExtended: boolean
  }
  errors?: string[]
  warnings?: string[]
}

const ALLOWED_UPLOAD_ROLES = ['admin', 'manager']

export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  const supabase = await createClient()
  const supabaseAdmin = createServiceClient()
  
  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized', errors: ['Please sign in to upload data'] },
      { status: 401 }
    )
  }

  try {
    const body: UploadRequest = await request.json()
    const { csvContent, filename, campaignName, propertyId, platform, preview = false } = body
    const normalizedPlatform = normalizeMarketingChannelId(platform) as MarketingPlatform

    // Validate required fields
    if (!csvContent) {
      return NextResponse.json(
        { success: false, message: 'Missing CSV content', errors: ['No CSV data provided'] },
        { status: 400 }
      )
    }

    if (!propertyId) {
      return NextResponse.json(
        { success: false, message: 'Missing property ID', errors: ['Property ID is required'] },
        { status: 400 }
      )
    }

    if (!campaignName) {
      return NextResponse.json(
        { success: false, message: 'Missing campaign name', errors: ['Campaign name is required'] },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { success: false, message: 'Forbidden', errors: ['Property access denied'] },
        { status: 403 }
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profileError || !ALLOWED_UPLOAD_ROLES.includes(profile?.role || '')) {
      return NextResponse.json(
        { success: false, message: 'Forbidden', errors: ['Permission denied'] },
        { status: 403 }
      )
    }

    // First, try to parse as time series or campaign summary
    const timeSeriesResult = parseMarketingCSV(csvContent, filename, campaignName, normalizedPlatform)
    
    // If it's a time series or campaign summary, handle it with the time series handler
    // (campaign_summary is structurally the same - rows of parsed marketing data)
    if (timeSeriesResult.success && (timeSeriesResult.reportType === 'time_series' || timeSeriesResult.reportType === 'campaign_summary')) {
      return handleTimeSeriesUpload(
        supabaseAdmin,
        timeSeriesResult,
        propertyId,
        filename,
        campaignName,
        user.id,
        preview
      )
    }

    // Not a time series - try parsing as extended report
    const extendedResult = parseExtendedReport(csvContent, filename, normalizedPlatform)
    
    if (!extendedResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Failed to parse CSV', 
          errors: extendedResult.errors,
          warnings: extendedResult.warnings
        },
        { status: 400 }
      )
    }

    // Handle extended report
    return handleExtendedUpload(
      supabaseAdmin,
      extendedResult,
      propertyId,
      filename,
      campaignName,
      normalizedPlatform,
      user.id,
      preview
    )

  } catch (err) {
    console.error('Upload API error:', err)
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error', 
        errors: [err instanceof Error ? err.message : 'Unknown error'] 
      },
      { status: 500 }
    )
  }
}

// Handle time series (daily data) upload
async function handleTimeSeriesUpload(
  supabase: ReturnType<typeof createServiceClient>,
  parseResult: { 
    success: boolean
    platform: MarketingPlatform
    reportType: string
    rows: ParsedMarketingRow[]
    dateRange: { start: string; end: string } | null
    errors: string[]
    warnings: string[]
  },
  propertyId: string,
  filename: string,
  campaignName: string,
  userId: string,
  preview: boolean
): Promise<NextResponse<UploadResponse>> {
  
  // Calculate totals for preview
  const totals = parseResult.rows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      spend: acc.spend + row.spend,
      conversions: acc.conversions + row.conversions,
    }),
    { impressions: 0, clicks: 0, spend: 0, conversions: 0 }
  )

  // If preview mode, return the parsed data without saving
  if (preview) {
    return NextResponse.json({
      success: true,
      message: `Parsed ${parseResult.rows.length} rows from time series`,
      preview: {
        rows: parseResult.rows.slice(0, 10),
        dateRange: parseResult.dateRange,
        platform: parseResult.platform,
        reportType: parseResult.reportType,
        totalRows: parseResult.rows.length,
        isExtended: false,
        totals,
      },
      warnings: parseResult.warnings,
    })
  }

  // Prepare records for database insertion
  const records = parseResult.rows.map(row => ({
    date: row.date,
    property_id: propertyId,
    channel_id: normalizeMarketingChannelId(row.channel_id),
    campaign_name: row.campaign_name,
    campaign_id: row.campaign_id,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    conversions: row.conversions,
    raw_source: `csv_upload:${filename}`,
  }))

  // Upsert to database
  const { error: upsertError } = await supabase
    .from('fact_marketing_performance')
    .upsert(records, { 
      onConflict: 'date,property_id,campaign_id',
      ignoreDuplicates: false 
    })

  if (upsertError) {
    console.error('Database upsert error:', upsertError)
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to save data', 
        errors: [upsertError.message] 
      },
      { status: 500 }
    )
  }

  // Log the upload
  await logUpload(supabase, propertyId, parseResult.platform, parseResult.reportType, filename, parseResult.dateRange, parseResult.rows.length, userId)

  return NextResponse.json({
    success: true,
    message: `Successfully imported ${parseResult.rows.length} rows`,
    imported: {
      rowCount: parseResult.rows.length,
      dateRange: parseResult.dateRange,
      reportType: parseResult.reportType,
      isExtended: false,
    },
    warnings: parseResult.warnings,
  })
}

// Handle extended reports (keywords, demographics, devices, etc.)
async function handleExtendedUpload(
  supabase: ReturnType<typeof createServiceClient>,
  parseResult: {
    success: boolean
    platform: MarketingPlatform
    reportType: string
    rows: ExtendedMetricsRow[]
    dateRange: { start: string; end: string } | null
    errors: string[]
    warnings: string[]
  },
  propertyId: string,
  filename: string,
  campaignName: string,
  platform: MarketingPlatform,
  userId: string,
  preview: boolean
): Promise<NextResponse<UploadResponse>> {

  // Calculate totals from metrics (try to extract spend, clicks, etc. from the JSON)
  const totals = parseResult.rows.reduce(
    (acc, row) => {
      const metrics = row.metrics
      return {
        impressions: acc.impressions + (typeof metrics.impressions === 'number' ? metrics.impressions : 0),
        clicks: acc.clicks + (typeof metrics.clicks === 'number' ? metrics.clicks : 0),
        spend: acc.spend + (typeof metrics.cost === 'number' ? metrics.cost : typeof metrics.spend === 'number' ? metrics.spend : 0),
        conversions: acc.conversions + (typeof metrics.conversions === 'number' ? metrics.conversions : 0),
      }
    },
    { impressions: 0, clicks: 0, spend: 0, conversions: 0 }
  )

  // If preview mode, return the parsed data without saving
  if (preview) {
    return NextResponse.json({
      success: true,
      message: `Parsed ${parseResult.rows.length} ${parseResult.reportType} records`,
      preview: {
        rows: parseResult.rows.slice(0, 10),
        dateRange: parseResult.dateRange,
        platform: platform,
        reportType: parseResult.reportType,
        totalRows: parseResult.rows.length,
        isExtended: true,
        totals,
      },
      warnings: parseResult.warnings,
    })
  }

  // Prepare records for extended table
  const records = parseResult.rows.map(row => ({
    property_id: propertyId,
    channel_id: normalizeMarketingChannelId(platform),
    campaign_name: campaignName,
    report_type: row.report_type,
    dimension_key: row.dimension_key,
    dimension_value: row.dimension_value,
    date_range_start: row.date_range_start,
    date_range_end: row.date_range_end,
    metrics: row.metrics,
    raw_source: `csv_upload:${filename}`,
  }))

  // Upsert to extended table
  const { error: upsertError } = await supabase
    .from('fact_marketing_extended')
    .upsert(records, { 
      onConflict: 'property_id,channel_id,report_type,dimension_value,date_range_start,date_range_end',
      ignoreDuplicates: false 
    })

  if (upsertError) {
    console.error('Database upsert error:', upsertError)
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to save data', 
        errors: [upsertError.message] 
      },
      { status: 500 }
    )
  }

  // Log the upload
  await logUpload(supabase, propertyId, platform, parseResult.reportType, filename, parseResult.dateRange, parseResult.rows.length, userId)

  return NextResponse.json({
    success: true,
    message: `Successfully imported ${parseResult.rows.length} ${parseResult.reportType} records`,
    imported: {
      rowCount: parseResult.rows.length,
      dateRange: parseResult.dateRange,
      reportType: parseResult.reportType,
      isExtended: true,
    },
    warnings: parseResult.warnings,
  })
}

// Log upload to audit table
async function logUpload(
  supabase: ReturnType<typeof createServiceClient>,
  propertyId: string,
  platform: string,
  reportType: string,
  filename: string,
  dateRange: { start: string; end: string } | null,
  rowCount: number,
  userId: string
) {
  try {
    await supabase.from('marketing_data_uploads').insert({
      property_id: propertyId,
      platform,
      report_type: reportType,
      file_name: filename,
      date_range_start: dateRange?.start,
      date_range_end: dateRange?.end,
      rows_imported: rowCount,
      uploaded_by: userId,
    })
  } catch {
    // Ignore audit log errors
    console.log('Note: Could not log upload to marketing_data_uploads')
  }
}

// GET endpoint to retrieve upload history
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const propertyId = searchParams.get('propertyId')

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { data: uploads, error } = await supabase
      .from('marketing_data_uploads')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ uploads: [] })
    }

    return NextResponse.json({ uploads: uploads || [] })
  } catch {
    return NextResponse.json({ uploads: [] })
  }
}
