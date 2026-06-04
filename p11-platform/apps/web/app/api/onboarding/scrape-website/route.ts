import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidInternalApiKey } from '@/utils/services/api-helpers'
import { upsertManagedKnowledgeSource } from '@/utils/services/knowledge-sources'
import {
  normalizePropertyScrapeUrl,
  scrapePropertyWebsite,
  type CentralizedPropertyScrapeResult,
} from '@/utils/property-scrape/centralized-property-scrape'
import type { Json } from '@/types/supabase'

interface WebsiteExtractionResult {
  success: boolean
  propertyName?: string
  amenities: string[]
  features: string[]
  petPolicy?: CentralizedPropertyScrapeResult['structured']['petPolicy']
  unitTypes: string[]
  specials: string[]
  contactInfo?: CentralizedPropertyScrapeResult['structured']['contactInfo']
  officeHours?: string
  brandVoice?: string
  targetAudience?: string
  neighborhoodInfo?: string
  rawChunks: string[]
  pagesScraped: number
  documentsCreated?: number
  crawl: CentralizedPropertyScrapeResult
}

async function enhanceWithAI(
  openai: OpenAI,
  chunks: string[]
): Promise<{ brandVoice?: string; targetAudience?: string; neighborhoodInfo?: string }> {
  try {
    const sampleContent = chunks.slice(0, 10).join('\n\n')
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You analyze property website content that has already been scoped to one property.
Return a JSON object with nullable fields:
- brand_voice: brief tone/personality
- target_audience: likely buyer/renter audience
- neighborhood_summary: 1-2 sentence location/community summary`,
        },
        {
          role: 'user',
          content: `Analyze this scoped property website content:\n\n${sampleContent.slice(0, 8000)}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    })
    const aiData = JSON.parse(response.choices[0].message.content || '{}')
    return {
      brandVoice: aiData.brand_voice || undefined,
      targetAudience: aiData.target_audience || undefined,
      neighborhoodInfo: aiData.neighborhood_summary || undefined,
    }
  } catch (error) {
    console.error('AI enhancement failed:', error)
    return {}
  }
}

function parseUrls(body: { urls?: unknown; websiteUrl?: unknown }): string[] {
  if (Array.isArray(body.urls)) {
    return body.urls.filter((url): url is string => typeof url === 'string')
  }
  if (typeof body.urls === 'string') return [body.urls]
  if (typeof body.websiteUrl === 'string') return [body.websiteUrl]
  return []
}

function buildCrawlMetadata(scrape: CentralizedPropertyScrapeResult, crawlRunId: string) {
  return {
    seed_url: scrape.seedUrl,
    scope_url: scrape.scopeUrl,
    scope_path: scrape.scopePath,
    origin: scrape.origin,
    crawl_run_id: crawlRunId,
    completed_at: new Date().toISOString(),
    pages_attempted: scrape.crawlSummary.pagesAttempted,
    pages_scraped: scrape.crawlSummary.pagesAudited,
    discovered_urls: scrape.discoveredUrls,
    accepted_urls: scrape.acceptedUrls,
    filtered_out_urls: scrape.filteredOutUrls,
    blocked_urls: scrape.blockedUrls,
    page_inventory: scrape.pages.map(page => ({
      url: page.url,
      status: page.status,
      reachable: page.reachable,
      page_type: page.pageType,
      title: page.title,
      meta_description: page.metaDescription,
      canonical_url: page.canonicalUrl,
      word_count: page.wordCount,
      h1: page.h1,
      h2: page.h2,
      structured_data_types: page.structuredDataTypes,
      json_ld_parse_errors: page.jsonLdParseErrors,
      faq_structured_data: page.faqStructuredData,
      organization_structured_data: page.organizationStructuredData,
      answer_block_signals: page.answerBlockSignals,
      internal_link_count: page.internalLinkCount,
      signals: page.signals,
      evidence_snippets: page.evidenceSnippets,
    })),
    missing_page_types: scrape.missingPageTypes,
    discovery_sources: scrape.crawlSummary.discoverySources,
  }
}

export async function POST(req: NextRequest) {
  try {
    const isInternalCall = hasValidInternalApiKey(req)
    let userId: string | null = null

    if (!isInternalCall) {
      const supabase = await createClient()
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = user.id
    }

    const body = await req.json()
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null

    if (isInternalCall && !propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required for internal calls' },
        { status: 400 }
      )
    }

    if (propertyId && userId) {
      const access = await validatePropertyAccess(userId, propertyId)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const requestedUrls = parseUrls(body)
    const validatedUrls = requestedUrls
      .map(url => normalizePropertyScrapeUrl(url))
      .filter((url): url is URL => Boolean(url))

    if (validatedUrls.length === 0) {
      return NextResponse.json({ error: 'At least one valid URL is required' }, { status: 400 })
    }

    const scrape = await scrapePropertyWebsite(validatedUrls[0].toString(), {
      additionalUrls: validatedUrls.slice(1).map(url => url.toString()),
    })

    if (!scrape || scrape.rawChunks.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Could not extract content from the scoped property website. The site may be blocking automated access or the URL may not contain property content.',
      }, { status: 400 })
    }

    const result: WebsiteExtractionResult = {
      success: true,
      propertyName: scrape.structured.propertyName,
      amenities: scrape.structured.amenities,
      features: scrape.structured.features,
      petPolicy: scrape.structured.petPolicy,
      unitTypes: scrape.structured.unitTypes,
      specials: scrape.structured.specials,
      contactInfo: scrape.structured.contactInfo,
      officeHours: scrape.structured.contactInfo?.officeHours,
      neighborhoodInfo: scrape.structured.neighborhoodSummary,
      rawChunks: scrape.rawChunks,
      pagesScraped: scrape.crawlSummary.pagesAudited,
      crawl: scrape,
    }

    if (process.env.OPENAI_API_KEY && result.rawChunks.length > 0) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const aiEnhancements = await enhanceWithAI(openai, result.rawChunks)
      result.brandVoice = aiEnhancements.brandVoice
      result.targetAudience = aiEnhancements.targetAudience
      result.neighborhoodInfo = aiEnhancements.neighborhoodInfo || result.neighborhoodInfo
    }

    if (propertyId && result.rawChunks.length > 0) {
      const adminClient = createServiceClient()
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const crawlRunId = new Date().toISOString()

      const allEmbeddings: number[][] = []
      const batchSize = 100
      for (let i = 0; i < result.rawChunks.length; i += batchSize) {
        const batch = result.rawChunks.slice(i, i + batchSize)
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
        })
        allEmbeddings.push(...embeddingResponse.data.map(e => e.embedding))
      }

      const pageTypeByUrl = new Map(scrape.pages.map(page => [page.url, page.pageType]))
      const payload = result.rawChunks.map((chunk, idx) => {
        const sourceUrl = scrape.chunkSourceUrls[idx] || scrape.scopeUrl
        return {
          content: chunk,
          metadata: {
            title: `Website Content - ${result.propertyName || 'Community'}`,
            source: sourceUrl,
            source_url: sourceUrl,
            source_origin: scrape.origin,
            source_scope: scrape.scopeUrl,
            source_path: new URL(sourceUrl).pathname,
            source_type: 'website_scrape',
            page_type: pageTypeByUrl.get(sourceUrl) || 'unknown',
            brand_origin: 'client_provided_material',
            crawl_run_id: crawlRunId,
            ingestion_run_id: crawlRunId,
            chunk_index: idx,
            total_chunks: result.rawChunks.length,
            scraped_at: new Date().toISOString(),
          } as Json,
          property_id: propertyId,
          embedding: `[${allEmbeddings[idx].join(',')}]`,
        }
      })

      const { error: insertError } = await adminClient.from('documents').insert(payload)
      if (insertError) {
        console.error('Failed to insert documents:', insertError)
        throw new Error('Failed to store refreshed website documents')
      }
      result.documentsCreated = result.rawChunks.length

      const extractedData = {
        brand_origin: 'client_provided_material',
        propertyName: result.propertyName ?? null,
        refresh_mode: 'replace_by_source_scope',
        ingestion_run_id: crawlRunId,
        crawl_run_id: crawlRunId,
        ingested_urls: scrape.acceptedUrls,
        amenities: result.amenities,
        features: result.features,
        petPolicy: result.petPolicy ?? null,
        unitTypes: result.unitTypes,
        specials: result.specials,
        contactInfo: result.contactInfo ?? null,
        brandVoice: result.brandVoice ?? null,
        targetAudience: result.targetAudience ?? null,
        neighborhoodInfo: result.neighborhoodInfo ?? null,
        crawl: buildCrawlMetadata(scrape, crawlRunId),
        structured: {
          ...scrape.structured,
          brandVoice: result.brandVoice ?? null,
          targetAudience: result.targetAudience ?? null,
          neighborhoodInfo: result.neighborhoodInfo ?? null,
        },
      } as Json

      try {
        await upsertManagedKnowledgeSource(adminClient, {
          propertyId,
          sourceType: 'website',
          sourceName: `Website: ${scrape.scopeUrl}`,
          sourceUrl: scrape.scopeUrl,
          status: 'completed',
          documentsCreated: result.rawChunks.length,
          extractedData,
        })
      } catch (sourceError) {
        console.error('Failed to upsert knowledge source:', sourceError)
        await adminClient
          .from('documents')
          .delete()
          .eq('property_id', propertyId)
          .eq('metadata->>crawl_run_id', crawlRunId)
        throw new Error('Failed to update website knowledge source')
      }

      const { error: deleteError } = await adminClient
        .from('documents')
        .delete()
        .eq('property_id', propertyId)
        .eq('metadata->>source_type', 'website_scrape')
        .eq('metadata->>source_scope', scrape.scopeUrl)
        .neq('metadata->>crawl_run_id', crawlRunId)

      if (deleteError) {
        console.error('Failed to delete stale website documents:', deleteError)
        throw new Error('Failed to finalize website refresh cleanup')
      }

      const propertyUpdate: Record<string, unknown> = {
        website_url: scrape.scopeUrl,
      }
      if (result.amenities.length > 0) propertyUpdate.amenities = result.amenities
      if (result.features.length > 0) propertyUpdate.special_features = result.features
      if (result.petPolicy) propertyUpdate.pet_policy = result.petPolicy as unknown as Json
      if (result.brandVoice) propertyUpdate.brand_voice = result.brandVoice
      if (result.targetAudience) propertyUpdate.target_audience = result.targetAudience
      if (result.officeHours) propertyUpdate.office_hours = { summary: result.officeHours } as Json

      const { error: propertyUpdateError } = await adminClient
        .from('properties')
        .update(propertyUpdate)
        .eq('id', propertyId)

      if (propertyUpdateError) {
        console.error('Failed to update property after website scrape:', propertyUpdateError)
      }
    }

    const { rawChunks: _rawChunks, crawl: _crawl, ...responseData } = result
    void _rawChunks
    void _crawl

    return NextResponse.json({
      ...responseData,
      crawl: {
        scopeUrl: scrape.scopeUrl,
        scopePath: scrape.scopePath,
        discoveredUrls: scrape.discoveredUrls,
        acceptedUrls: scrape.acceptedUrls,
        filteredOutUrls: scrape.filteredOutUrls,
        missingPageTypes: scrape.missingPageTypes,
        pagesAttempted: scrape.crawlSummary.pagesAttempted,
        pagesAudited: scrape.crawlSummary.pagesAudited,
      },
      chunksCreated: result.rawChunks.length,
    })
  } catch (error) {
    console.error('Website scrape error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Server error',
    }, { status: 500 })
  }
}
