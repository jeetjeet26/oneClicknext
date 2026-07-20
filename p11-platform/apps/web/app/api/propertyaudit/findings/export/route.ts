/**
 * PropertyAudit Findings CSV Export
 * Columns match the agency deliverable format:
 * Type, Issue, Description, Occurrences, Date Discovered, Date Fixed, Notes
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const CATEGORY_LABELS: Record<string, string> = {
  crawling_indexing: 'Crawling/Indexing',
  canonicals: 'Canonicals',
  titles: 'Titles',
  descriptions: 'Descriptions',
  h1s: 'H1s',
  content: 'Content',
  links: 'Links',
  images: 'Images',
  security: 'Security',
  urls: 'URLs',
  geo_signals: 'GEO Signals',
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function formatDate(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const includeFixed = searchParams.get('includeFixed') !== 'false'

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = createServiceClient()

    const { data: property } = await serviceClient
      .from('properties')
      .select('name')
      .eq('id', propertyId)
      .single()

    let query = serviceClient
      .from('geo_site_findings')
      .select('category, title, description, occurrences, first_detected_at, fixed_at, status, owner, notes')
      .eq('property_id', propertyId)
      .order('category')
      .order('first_detected_at', { ascending: false })

    if (!includeFixed) {
      query = query.neq('status', 'fixed')
    }

    const { data: findings, error } = await query
    if (error) {
      console.error('[Findings Export] Query error:', error)
      return NextResponse.json({ error: 'Failed to load findings' }, { status: 500 })
    }

    const header = ['Type', 'Issue', 'Description', 'Occurrences', 'Date Discovered', 'Date Fixed', 'Owner', 'Status', 'Notes']
    const rows = (findings || []).map(finding => [
      csvEscape(CATEGORY_LABELS[finding.category] || finding.category),
      csvEscape(finding.title),
      csvEscape(finding.description),
      csvEscape(finding.occurrences),
      csvEscape(formatDate(finding.first_detected_at)),
      csvEscape(formatDate(finding.fixed_at)),
      csvEscape(finding.owner || ''),
      csvEscape(finding.status),
      csvEscape(finding.notes || ''),
    ].join(','))

    const csv = [header.join(','), ...rows].join('\r\n')
    const safeName = (property?.name || 'property').replace(/[^a-z0-9]+/gi, '-').toLowerCase()

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-technical-findings.csv"`,
      },
    })
  } catch (error) {
    console.error('PropertyAudit Findings Export Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
