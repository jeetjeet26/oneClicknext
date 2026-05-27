import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getDataEngineUrl } from '@/utils/services/runtime-config'
import {
  parseCompetitorIntakeText,
  type ParsedCompetitorSeed,
} from '@/utils/services/competitor-intake-parser'
import type { Database, Json } from '@/types/supabase'

type IntakeBatchRow = Database['public']['Tables']['competitor_intake_batches']['Row']
type IntakeCandidateRow = Database['public']['Tables']['competitor_intake_candidates']['Row']

const MAX_INTAKE_TEXT_LENGTH = 100_000

function formatCandidate(row: IntakeCandidateRow) {
  return {
    id: row.id,
    batchId: row.batch_id,
    propertyId: row.property_id,
    competitorId: row.competitor_id,
    seedName: row.seed_name,
    seedLocation: row.seed_location,
    seedUrl: row.seed_url,
    seedSnippet: row.seed_snippet,
    seedClaims: row.seed_claims,
    enrichmentStatus: row.enrichment_status,
    evidenceSummary: row.evidence_summary,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function formatBatch(row: IntakeBatchRow) {
  return {
    id: row.id,
    propertyId: row.property_id,
    submittedBy: row.submitted_by,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

async function triggerEnrichment(args: {
  batchId: string
  propertyId: string
}): Promise<{ started: boolean; warning?: string }> {
  try {
    const response = await fetch(`${getDataEngineUrl()}/competitor-intake/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: args.batchId,
        property_id: args.propertyId,
      }),
    })

    if (!response.ok) {
      const details = await response.text()
      return {
        started: false,
        warning: details || 'Data engine rejected competitor intake enrichment request',
      }
    }

    return { started: true }
  } catch (error) {
    return {
      started: false,
      warning: error instanceof Error ? error.message : 'Data engine is not reachable',
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { propertyId, rawText } = body

    if (!propertyId || typeof propertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ error: 'rawText required' }, { status: 400 })
    }

    const cleanedRawText = rawText.trim()
    if (cleanedRawText.length < 20) {
      return NextResponse.json({ error: 'rawText too short' }, { status: 400 })
    }

    if (cleanedRawText.length > MAX_INTAKE_TEXT_LENGTH) {
      return NextResponse.json({ error: 'rawText too long' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsedCandidates = parseCompetitorIntakeText(cleanedRawText)
    if (parsedCandidates.length === 0) {
      return NextResponse.json({ error: 'No competitor candidates found' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: batch, error: batchError } = await supabase
      .from('competitor_intake_batches')
      .insert({
        property_id: propertyId,
        submitted_by: user.id,
        raw_text: cleanedRawText,
        status: 'pending',
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Competitor intake batch insert error:', batchError)
      return NextResponse.json({ error: 'Failed to create intake batch' }, { status: 500 })
    }

    const candidatePayload = parsedCandidates.map((candidate: ParsedCompetitorSeed) => ({
      batch_id: batch.id,
      property_id: propertyId,
      seed_name: candidate.seedName,
      seed_location: candidate.seedLocation,
      seed_url: candidate.seedUrl,
      seed_snippet: candidate.seedSnippet,
      seed_claims: candidate.seedClaims as Json,
      enrichment_status: 'pending',
      evidence_summary: {
        origin: 'client_provided_seed',
        canonical_truth: false,
      } as Json,
    }))

    const { data: candidates, error: candidatesError } = await supabase
      .from('competitor_intake_candidates')
      .insert(candidatePayload)
      .select()

    if (candidatesError || !candidates) {
      console.error('Competitor intake candidate insert error:', candidatesError)
      await supabase.from('competitor_intake_batches').delete().eq('id', batch.id)
      return NextResponse.json({ error: 'Failed to create intake candidates' }, { status: 500 })
    }

    const enrichment = await triggerEnrichment({ batchId: batch.id, propertyId })
    if (enrichment.started) {
      await supabase
        .from('competitor_intake_batches')
        .update({ status: 'processing' })
        .eq('id', batch.id)
    }

    return NextResponse.json({
      success: true,
      batch: formatBatch({
        ...batch,
        status: enrichment.started ? 'processing' : batch.status,
      }),
      candidates: candidates.map(formatCandidate),
      enrichment,
    }, { status: 202 })
  } catch (error) {
    console.error('Competitor Intake POST Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = req.nextUrl.searchParams.get('propertyId')
    const batchId = req.nextUrl.searchParams.get('batchId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()

    if (batchId) {
      const { data: batch, error: batchError } = await supabase
        .from('competitor_intake_batches')
        .select('*')
        .eq('id', batchId)
        .eq('property_id', propertyId)
        .single()

      if (batchError || !batch) {
        return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
      }

      const { data: candidates, error: candidatesError } = await supabase
        .from('competitor_intake_candidates')
        .select('*')
        .eq('batch_id', batchId)
        .eq('property_id', propertyId)
        .order('created_at', { ascending: true })

      if (candidatesError) {
        console.error('Competitor intake candidates fetch error:', candidatesError)
        return NextResponse.json({ error: 'Failed to fetch intake candidates' }, { status: 500 })
      }

      return NextResponse.json({
        batch: formatBatch(batch),
        candidates: (candidates || []).map(formatCandidate),
      })
    }

    const { data: batches, error } = await supabase
      .from('competitor_intake_batches')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('Competitor intake batches fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch intake batches' }, { status: 500 })
    }

    return NextResponse.json({
      batches: (batches || []).map(formatBatch),
    })
  } catch (error) {
    console.error('Competitor Intake GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
