import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { persistObservedReviews, type ObservedReview } from '@/utils/reviewflow/ingestion'
import { ensureCaseForReview } from '@/utils/reviewflow/cases'
import { runBatchAnalysis } from '@/utils/reviewflow/analysis-pipeline'
import { runSharedExecutorJob } from '@/utils/services/shared-executor'

// Cap on synchronous classification per import; the remainder stays 'pending'
// and is drained by analyze-batch.
const IMPORT_ANALYSIS_CAP = Number(process.env.REVIEWFLOW_IMPORT_ANALYSIS_CAP || 10)

const IMPORTABLE_PLATFORMS = new Set(['google', 'yelp', 'apartments_com', 'facebook', 'other'])

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const propertyId = formData.get('propertyId') as string

    if (!file || !propertyId) {
      return NextResponse.json(
        { error: 'File and propertyId are required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()

    // Parse CSV
    const text = await file.text()
    const lines = text.split('\n').filter(line => line.trim())
    
    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV file must have headers and at least one data row' },
        { status: 400 }
      )
    }

    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
    const requiredHeaders = ['platform', 'review_text']
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
    
    if (missingHeaders.length > 0) {
      return NextResponse.json(
        { error: `Missing required columns: ${missingHeaders.join(', ')}` },
        { status: 400 }
      )
    }

    // Parse rows grouped by platform (stable identity is per platform).
    const reviewsByPlatform = new Map<string, ObservedReview[]>()
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])

      if (values.length !== headers.length) continue

      const row: Record<string, string> = {}
      headers.forEach((header, index) => {
        row[header] = values[index]?.replace(/^"|"$/g, '').trim() || ''
      })

      const reviewText = row.review_text || row.reviewtext
      if (!reviewText) continue

      const rawPlatform = (row.platform || 'other').toLowerCase()
      const platform = IMPORTABLE_PLATFORMS.has(rawPlatform) ? rawPlatform : 'other'
      const parsedRating = row.rating ? parseInt(row.rating) : NaN

      const list = reviewsByPlatform.get(platform) || []
      list.push({
        platformReviewId: row.platform_review_id || row.platformreviewid || null,
        reviewerName: row.reviewer_name || row.reviewername || 'Anonymous',
        reviewerAvatarUrl: null,
        rating: Number.isFinite(parsedRating) && parsedRating >= 1 && parsedRating <= 5 ? parsedRating : null,
        reviewText,
        reviewDate: row.review_date || row.reviewdate || null,
      })
      reviewsByPlatform.set(platform, list)
    }

    const totalParsed = Array.from(reviewsByPlatform.values()).reduce(
      (sum, list) => sum + list.length,
      0
    )
    if (totalParsed === 0) {
      return NextResponse.json(
        { error: 'No valid reviews found in CSV' },
        { status: 400 }
      )
    }

    const { data: property } = await supabase
      .from('properties')
      .select('org_id')
      .eq('id', propertyId)
      .single()

    if (!property?.org_id) {
      return NextResponse.json({ error: 'Property is missing org context' }, { status: 409 })
    }

    // Durable import job: replay-safe persistence + awaited bounded analysis.
    const result = await runSharedExecutorJob({
      orgId: property.org_id,
      propertyId,
      domain: 'reviewflow.import',
      subjectType: 'csv_import',
      requestedBy: user.id,
      payload: { fileName: file.name, rowCount: totalParsed },
      execute: async () => {
        let inserted = 0
        let updated = 0
        let unchanged = 0
        const insertedReviews: Array<{
          id: string
          property_id: string | null
          review_text: string | null
          rating: number | null
          reviewer_name: string | null
          platform: string
        }> = []

        for (const [platform, reviews] of reviewsByPlatform) {
          const persisted = await persistObservedReviews(supabase, {
            propertyId,
            platform,
            reviews,
            retrievalMethod: 'csv_import',
            completeness: 'unknown',
          })
          inserted += persisted.inserted
          updated += persisted.updated
          unchanged += persisted.unchanged
          insertedReviews.push(...persisted.insertedReviews)
        }

        for (const review of insertedReviews) {
          await ensureCaseForReview(supabase, review)
        }

        const toAnalyze = insertedReviews.slice(0, IMPORT_ANALYSIS_CAP)
        const analysisSummary =
          toAnalyze.length > 0
            ? await runBatchAnalysis(supabase, toAnalyze)
            : { analyzed: 0, manualReviewRequired: 0, skipped: 0, results: [] }

        return {
          inserted,
          updated,
          unchanged,
          analyzed: analysisSummary.analyzed,
          manualReviewRequired: analysisSummary.manualReviewRequired,
          pendingAnalysis: Math.max(inserted - toAnalyze.length, 0),
        }
      },
    })

    return NextResponse.json({
      success: true,
      imported: result.inserted,
      ...result,
    })

  } catch (error) {
    console.error('CSV import error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}

// Helper to parse CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  
  result.push(current)
  return result
}

