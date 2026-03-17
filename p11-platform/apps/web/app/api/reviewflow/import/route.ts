import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

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

    // Parse rows
    const reviews: Array<{
      property_id: string
      platform: string
      reviewer_name: string | null
      rating: number | null
      review_text: string
      review_date: string | null
      response_status: string
    }> = []

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      
      if (values.length !== headers.length) continue

      const row: Record<string, string> = {}
      headers.forEach((header, index) => {
        row[header] = values[index]?.replace(/^"|"$/g, '').trim() || ''
      })

      if (!row.review_text) continue

      reviews.push({
        property_id: propertyId,
        platform: row.platform || 'other',
        reviewer_name: row.reviewer_name || row.reviewername || null,
        rating: row.rating ? parseInt(row.rating) : null,
        review_text: row.review_text || row.reviewtext,
        review_date: row.review_date || row.reviewdate || null,
        response_status: 'pending'
      })
    }

    if (reviews.length === 0) {
      return NextResponse.json(
        { error: 'No valid reviews found in CSV' },
        { status: 400 }
      )
    }

    // Insert reviews
    const { data, error } = await supabase
      .from('reviews')
      .insert(reviews)
      .select()

    if (error) {
      console.error('Error inserting reviews:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Analyze imported reviews in the background
    if (data && data.length > 0) {
      // Don't await - let it process in background
      analyzeReviewsBatch(data.map(r => r.id))
    }

    return NextResponse.json({
      success: true,
      imported: data?.length || 0
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

// Analyze reviews in background
async function analyzeReviewsBatch(reviewIds: string[]) {
  for (const reviewId of reviewIds) {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/reviewflow/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId })
      })
    } catch (error) {
      console.error(`Error analyzing review ${reviewId}:`, error)
    }
  }
}

