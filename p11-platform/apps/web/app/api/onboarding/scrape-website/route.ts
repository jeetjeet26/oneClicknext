import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidInternalApiKey } from '@/utils/services/api-helpers'
import { upsertManagedKnowledgeSource } from '@/utils/services/knowledge-sources'
import type { Json } from '@/types/supabase'
import OpenAI from 'openai'
import * as cheerio from 'cheerio'

// Types for extracted data
interface ExtractedContent {
  url: string
  title: string
  content: string
  pageType: string
}

interface PetPolicy {
  petsAllowed: boolean
  deposit?: number
  monthlyRent?: number
  weightLimitLbs?: number
  maxPets?: number
  breedRestrictions?: boolean
  details?: string[]
}

interface ContactInfo {
  phone?: string
  email?: string
  address?: string
  officeHours?: string
}

interface WebsiteExtractionResult {
  success: boolean
  propertyName?: string
  amenities: string[]
  petPolicy?: PetPolicy
  unitTypes: string[]
  specials: string[]
  contactInfo?: ContactInfo
  officeHours?: string
  brandVoice?: string
  targetAudience?: string
  neighborhoodInfo?: string
  rawChunks: string[]
  pagesScraped: number
  documentsCreated?: number
}

// No longer using automatic path discovery - users specify exact URLs to scrape

// Amenity keywords to look for
const AMENITY_KEYWORDS = [
  'pool', 'fitness', 'gym', 'dog park', 'pet park', 'clubhouse',
  'business center', 'playground', 'tennis', 'basketball', 'volleyball',
  'bbq', 'grill', 'fire pit', 'rooftop', 'parking garage', 'ev charging',
  'package locker', 'concierge', 'theater', 'game room', 'spa', 'sauna',
  'yoga', 'co-working', 'coworking', 'pet spa', 'bike storage', 'storage',
  'laundry', 'washer', 'dryer', 'dishwasher', 'granite', 'stainless',
  'balcony', 'patio', 'fireplace', 'hardwood', 'walk-in closet',
  'ceiling fan', 'air conditioning', 'central heat', 'gated', 'security'
]

// Helper to clean text
function cleanText(text: string | undefined | null): string {
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim()
}

// Helper to extract text from HTML
function extractTextFromHtml($: cheerio.CheerioAPI): string {
  // Remove script and style elements
  $('script, style, nav, header, footer, noscript').remove()
  
  const text = $('body').text()
  
  // Clean up whitespace
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 3)
    .join('\n')
}

// Identify page type based on URL and content
function identifyPageType(url: string, title: string, content: string): string {
  const urlLower = url.toLowerCase()
  const titleLower = title.toLowerCase()
  const contentSample = content.slice(0, 2000).toLowerCase()
  
  const pageTypes: Record<string, string[]> = {
    amenities: ['amenity', 'amenities', 'feature', 'community features'],
    floor_plans: ['floor plan', 'floorplan', 'apartment', 'bedroom', 'studio'],
    contact: ['contact', 'get in touch', 'reach us', 'office hours'],
    pet_policy: ['pet', 'dog', 'cat', 'animal'],
    specials: ['special', 'deal', 'promotion', 'offer', 'discount', 'move-in'],
    neighborhood: ['neighborhood', 'location', 'nearby', 'area'],
    about: ['about', 'our story', 'history', 'welcome'],
    gallery: ['gallery', 'photo', 'image', 'tour'],
    faq: ['faq', 'frequently asked', 'question'],
  }
  
  for (const [pageType, keywords] of Object.entries(pageTypes)) {
    for (const keyword of keywords) {
      if (urlLower.includes(keyword) || titleLower.includes(keyword) || contentSample.includes(keyword)) {
        return pageType
      }
    }
  }
  
  return 'general'
}

// Extract amenities from content
function extractAmenities(content: string): string[] {
  const amenities = new Set<string>()
  const contentLower = content.toLowerCase()
  
  for (const keyword of AMENITY_KEYWORDS) {
    if (contentLower.includes(keyword)) {
      // Capitalize nicely
      const amenity = keyword.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      amenities.add(amenity)
    }
  }
  
  return Array.from(amenities).slice(0, 30)
}

// Extract pet policy from content
function extractPetPolicy(content: string): PetPolicy | undefined {
  const contentLower = content.toLowerCase()
  
  if (!contentLower.includes('pet') && !contentLower.includes('dog')) {
    return undefined
  }
  
  const policy: PetPolicy = {
    petsAllowed: true,
    details: []
  }
  
  // Check if pets are not allowed
  const noPetPhrases = ['no pets', 'pets not allowed', 'pet-free', 'no animals']
  for (const phrase of noPetPhrases) {
    if (contentLower.includes(phrase)) {
      policy.petsAllowed = false
      return policy
    }
  }
  
  // Extract deposit
  const depositMatch = contentLower.match(/\$(\d+)\s*(?:pet\s*)?deposit/i)
  if (depositMatch) {
    policy.deposit = parseInt(depositMatch[1])
  }
  
  // Extract monthly rent
  const rentMatch = contentLower.match(/\$(\d+)\s*(?:monthly|month|\/mo)?\s*pet\s*rent/i)
  if (rentMatch) {
    policy.monthlyRent = parseInt(rentMatch[1])
  }
  
  // Extract weight limit
  const weightMatch = contentLower.match(/(\d+)\s*(?:lb|pound)s?\s*(?:limit|max|weight)/i)
  if (weightMatch) {
    policy.weightLimitLbs = parseInt(weightMatch[1])
  }
  
  // Extract pet limit
  const limitMatch = contentLower.match(/(\d+)\s*pets?\s*(?:max|maximum|limit|allowed)/i)
  if (limitMatch) {
    policy.maxPets = parseInt(limitMatch[1])
  }
  
  // Breed restrictions
  if (contentLower.includes('breed restriction') || contentLower.includes('restricted breed')) {
    policy.breedRestrictions = true
  }
  
  return policy
}

// Extract contact info
function extractContactInfo(content: string): ContactInfo | undefined {
  const contact: ContactInfo = {}
  
  // Phone
  const phoneMatch = content.match(/(?:phone|tel|call)[:\s]*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i)
  if (phoneMatch) {
    contact.phone = phoneMatch[1]
  } else {
    const genericPhoneMatch = content.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
    if (genericPhoneMatch) {
      contact.phone = genericPhoneMatch[0]
    }
  }
  
  // Email
  const emailMatch = content.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  if (emailMatch && !emailMatch[0].toLowerCase().includes('example')) {
    contact.email = emailMatch[0]
  }
  
  // Office hours
  const hoursMatch = content.match(/(?:office\s*hours|hours)[:\s]*([^\n]{10,100})/i)
  if (hoursMatch) {
    contact.officeHours = cleanText(hoursMatch[1])
  }
  
  return Object.keys(contact).length > 0 ? contact : undefined
}

// Extract specials
function extractSpecials(content: string): string[] {
  const specials: string[] = []
  const contentLower = content.toLowerCase()
  
  const patterns = [
    /(\$\d+\s*off[^.!]*[.!])/gi,
    /(\d+\s*(?:month|week)s?\s*free[^.!]*[.!])/gi,
    /(free\s*(?:month|rent|application)[^.!]*[.!])/gi,
    /(waived?\s*(?:fee|deposit|application)[^.!]*[.!])/gi,
    /(move.?in\s*special[^.!]*[.!])/gi,
  ]
  
  for (const pattern of patterns) {
    const matches = contentLower.matchAll(pattern)
    for (const match of matches) {
      const cleaned = cleanText(match[1])
      if (cleaned.length > 10) {
        specials.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1))
      }
    }
  }
  
  return [...new Set(specials)].slice(0, 5)
}

// Extract unit types
function extractUnitTypes(content: string): string[] {
  const unitTypes = new Set<string>()
  const contentLower = content.toLowerCase()
  
  if (contentLower.includes('studio')) {
    unitTypes.add('Studio')
  }
  
  const bedMatches = contentLower.matchAll(/(\d+)\s*(?:bed|br|bedroom)/gi)
  for (const match of bedMatches) {
    unitTypes.add(`${match[1]} Bedroom`)
  }
  
  const wordMatches = contentLower.matchAll(/(one|two|three|four)\s*bedroom/gi)
  const nums: Record<string, string> = { one: '1', two: '2', three: '3', four: '4' }
  for (const match of wordMatches) {
    unitTypes.add(`${nums[match[1].toLowerCase()]} Bedroom`)
  }
  
  return Array.from(unitTypes).sort()
}

// Chunk content for RAG
function chunkContent(content: string, maxSize = 800, overlap = 100): string[] {
  const chunks: string[] = []
  const sentences = content.split(/(?<=[.!?])\s+/)
  
  let currentChunk = ''
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      const words = currentChunk.split(' ')
      const overlapWords = words.slice(-Math.floor(overlap / 5))
      currentChunk = overlapWords.join(' ') + ' ' + sentence
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }
  
  return chunks.filter(chunk => chunk.length > 50)
}

// Fetch a single page
async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      // 10 second timeout
      signal: AbortSignal.timeout(10000),
    })
    
    if (!response.ok) return null
    return await response.text()
  } catch (error) {
    console.warn(`Failed to fetch ${url}:`, error)
    return null
  }
}

// AI-enhanced extraction using OpenAI
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
          content: `You are an expert at analyzing apartment community websites.
          Extract structured information from the content provided.
          Return a JSON object with these fields (use null if not found):
          - brand_voice: A brief description of the community's tone/personality (friendly, luxury, modern, etc.)
          - target_audience: Who the community seems to target (young professionals, families, seniors, students, etc.)
          - neighborhood_summary: A brief summary of the neighborhood/location benefits (1-2 sentences)`
        },
        {
          role: 'user',
          content: `Analyze this apartment community website content:\n\n${sampleContent.slice(0, 8000)}`
        }
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

    const { urls, websiteUrl, propertyId } = await req.json()

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

    // Accept either 'urls' array or legacy 'websiteUrl' string
    let urlsToScrape: string[] = []
    if (Array.isArray(urls)) {
      urlsToScrape = urls
    } else if (typeof urls === 'string') {
      urlsToScrape = [urls]
    } else if (typeof websiteUrl === 'string') {
      urlsToScrape = [websiteUrl]
    }

    if (urlsToScrape.length === 0) {
      return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 })
    }

    // Normalize and validate all URLs
    const validatedUrls: URL[] = []
    for (const url of urlsToScrape) {
      let normalizedUrl = url.trim()
      if (!normalizedUrl) continue
      
      if (!normalizedUrl.startsWith('http')) {
        normalizedUrl = 'https://' + normalizedUrl
      }

      try {
        validatedUrls.push(new URL(normalizedUrl))
      } catch {
        console.warn(`Skipping invalid URL: ${url}`)
      }
    }

    if (validatedUrls.length === 0) {
      return NextResponse.json({ error: 'No valid URLs provided' }, { status: 400 })
    }

    console.log(`Starting website scrape for ${validatedUrls.length} URLs`)

    // Scrape all provided URLs
    const scrapedContent: ExtractedContent[] = []
    const scrapedUrls = new Set<string>()

    for (const urlObj of validatedUrls) {
      const pageUrl = urlObj.toString()
      
      if (scrapedUrls.has(pageUrl)) continue
      scrapedUrls.add(pageUrl)

      const html = await fetchPage(pageUrl)
      if (!html) {
        console.warn(`Failed to fetch: ${pageUrl}`)
        continue
      }

      const $ = cheerio.load(html)
      const title = cleanText($('title').text())
      const content = extractTextFromHtml($)

      if (content.length < 100) {
        console.warn(`Skipping ${pageUrl} - content too short`)
        continue
      }

      const pageType = identifyPageType(pageUrl, title, content)

      scrapedContent.push({
        url: pageUrl,
        title,
        content,
        pageType,
      })

      console.log(`Scraped: ${pageUrl} (${pageType})`)

      // Small delay between requests to be polite
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (scrapedContent.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Could not extract content from any of the provided URLs. The sites may be blocking automated access.',
      }, { status: 400 })
    }

    const ingestedUrls = validatedUrls.map(url => url.toString())

    // Use first URL's origin as the base for property identification
    const baseUrl = validatedUrls[0]

    // Aggregate extracted data
    const result: WebsiteExtractionResult = {
      success: true,
      amenities: [],
      unitTypes: [],
      specials: [],
      rawChunks: [],
      pagesScraped: scrapedContent.length,
    }
  const chunkSourceUrls: string[] = []

    const allAmenities = new Set<string>()
    const allUnitTypes = new Set<string>()
    const allSpecials: string[] = []

    for (const page of scrapedContent) {
      // Extract property name from first page if not already set
      if (!result.propertyName && page.title) {
        let name = page.title
        // Remove common suffixes
        for (const suffix of ['| Apartments', '- Apartments', 'Apartments', '| Home', '- Home']) {
          name = name.replace(suffix, '')
        }
        result.propertyName = cleanText(name)
      }

      // Extract amenities
      const amenities = extractAmenities(page.content)
      amenities.forEach(a => allAmenities.add(a))

      // Extract pet policy (prefer dedicated pet page)
      if (page.pageType === 'pet_policy') {
        result.petPolicy = extractPetPolicy(page.content)
      } else if (!result.petPolicy) {
        const petPolicy = extractPetPolicy(page.content)
        if (petPolicy) result.petPolicy = petPolicy
      }

      // Extract contact info
      const contactInfo = extractContactInfo(page.content)
      if (contactInfo) {
        if (!result.contactInfo) {
          result.contactInfo = contactInfo
        } else {
          // Merge
          if (contactInfo.phone && !result.contactInfo.phone) result.contactInfo.phone = contactInfo.phone
          if (contactInfo.email && !result.contactInfo.email) result.contactInfo.email = contactInfo.email
          if (contactInfo.officeHours && !result.contactInfo.officeHours) result.contactInfo.officeHours = contactInfo.officeHours
        }
      }

      // Extract specials
      const specials = extractSpecials(page.content)
      allSpecials.push(...specials)

      // Extract unit types
      const unitTypes = extractUnitTypes(page.content)
      unitTypes.forEach(u => allUnitTypes.add(u))

      // Create chunks for RAG
      const chunks = chunkContent(page.content)
      for (const chunk of chunks) {
        result.rawChunks.push(`[Source URL: ${page.url} | Page Type: ${page.pageType}]\n${chunk}`)
        chunkSourceUrls.push(page.url)
      }
    }

    result.amenities = Array.from(allAmenities)
    result.unitTypes = Array.from(allUnitTypes).sort()
    result.specials = [...new Set(allSpecials)]

    // Extract office hours from contact info
    if (result.contactInfo?.officeHours) {
      result.officeHours = result.contactInfo.officeHours
    }

    // AI enhancement if OpenAI key is available
    if (process.env.OPENAI_API_KEY && result.rawChunks.length > 0) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const aiEnhancements = await enhanceWithAI(openai, result.rawChunks)
      result.brandVoice = aiEnhancements.brandVoice
      result.targetAudience = aiEnhancements.targetAudience
      result.neighborhoodInfo = aiEnhancements.neighborhoodInfo
    }

    // If propertyId provided, store chunks in vector DB and create knowledge source record
    if (propertyId && result.rawChunks.length > 0) {
      const adminClient = createServiceClient()
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const ingestionRunId = new Date().toISOString()

      // Generate embeddings for chunks
      const BATCH_SIZE = 100
      const allEmbeddings: number[][] = []

      for (let i = 0; i < result.rawChunks.length; i += BATCH_SIZE) {
        const batch = result.rawChunks.slice(i, i + BATCH_SIZE)
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
        })
        allEmbeddings.push(...embeddingResponse.data.map(e => e.embedding))
      }

      // Idempotent refresh semantics: replace prior website_scrape chunks for this source.
      await adminClient
        .from('documents')
        .delete()
        .eq('property_id', propertyId)
        .eq('metadata->>source_type', 'website_scrape')
        .eq('metadata->>source_origin', baseUrl.origin)

      // Insert documents
      const payload = result.rawChunks.map((chunk, idx) => ({
        content: chunk,
        metadata: {
          title: `Website Content - ${result.propertyName || 'Community'}`,
          source: chunkSourceUrls[idx] || baseUrl.origin,
          source_origin: baseUrl.origin,
          source_type: 'website_scrape',
          brand_origin: 'client_provided_material',
          ingestion_run_id: ingestionRunId,
          chunk_index: idx,
          total_chunks: result.rawChunks.length,
          scraped_at: new Date().toISOString(),
        } as Json,
        property_id: propertyId,
        embedding: `[${allEmbeddings[idx].join(',')}]`,
      }))

      const { error: insertError } = await adminClient.from('documents').insert(payload)
      
      if (insertError) {
        console.error('Failed to insert documents:', insertError)
      } else {
        result.documentsCreated = result.rawChunks.length
      }

      const extractedData = {
        brand_origin: 'client_provided_material',
        propertyName: result.propertyName ?? null,
        refresh_mode: 'replace_by_source_origin',
        ingestion_run_id: ingestionRunId,
        ingested_urls: ingestedUrls,
        amenities: result.amenities,
        petPolicy: result.petPolicy ?? null,
        unitTypes: result.unitTypes,
        specials: result.specials,
        contactInfo: result.contactInfo ?? null,
        brandVoice: result.brandVoice ?? null,
        targetAudience: result.targetAudience ?? null,
      } as Json

      try {
        await upsertManagedKnowledgeSource(adminClient, {
          propertyId,
          sourceType: 'website',
          sourceName: `Website: ${baseUrl.origin}`,
          sourceUrl: baseUrl.origin,
          status: 'completed',
          documentsCreated: result.rawChunks.length,
          extractedData,
        })
      } catch (sourceError) {
        console.error('Failed to upsert knowledge source:', sourceError)
      }

      // Keep setup truth on properties; avoid community_profiles drift.
      const { error: propertyUpdateError } = await adminClient
        .from('properties')
        .update({
          website_url: baseUrl.origin,
          amenities: result.amenities.length > 0 ? result.amenities : undefined,
          pet_policy: (result.petPolicy ?? null) as unknown as Json,
          brand_voice: result.brandVoice || undefined,
          target_audience: result.targetAudience || undefined,
        })
        .eq('id', propertyId)

      if (propertyUpdateError) {
        console.error('Failed to update property after website scrape:', propertyUpdateError)
      }
    }

    // Don't return raw chunks in API response (too large)
    const { rawChunks: _rawChunks, ...responseData } = result
    void _rawChunks

    return NextResponse.json({
      ...responseData,
      chunksCreated: result.rawChunks.length,
    })

  } catch (error) {
    console.error('Website scrape error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Server error',
    }, { status: 500 })
  }
}


