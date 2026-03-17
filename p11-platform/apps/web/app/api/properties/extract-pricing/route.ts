/**
 * Property Pricing Extraction API
 * Extracts structured pricing/floor plan data from pasted property website content
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import OpenAI from 'openai'
import { syncPropertyUnitsToKnowledgeBase } from '@/utils/property-units-kb-sync'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

interface ExtractedUnit {
  unitType: string
  bedrooms: number
  bathrooms: number
  sqftMin: number | null
  sqftMax: number | null
  rentMin: number | null
  rentMax: number | null
  availableCount: number
  moveInSpecials: string | null
}

interface ExtractionResult {
  units: ExtractedUnit[]
  propertySpecials: string | null
  confidence: number
  rawDataQuality: 'high' | 'medium' | 'low'
  notes: string | null
}

const EXTRACTION_PROMPT = `You are an expert at extracting structured floor plan and pricing data from apartment listing websites.

Analyze the following pasted content from a property's apartment website and extract all floor plan/unit type information.

For each unit type found, extract:
- unitType: The floor plan name/code (e.g., "S1", "A1", "Studio", "1BR-A")
- bedrooms: Number of bedrooms (0 for studio)
- bathrooms: Number of bathrooms (1, 1.5, 2, etc.)
- sqftMin: Minimum square footage (null if not found)
- sqftMax: Maximum square footage (null if not found, same as min if only one number)
- rentMin: Starting/minimum rent price (null if "Call for details" or not found)
- rentMax: Maximum rent price (null if not found, same as min if only one number)
- availableCount: Number of available units (0 if not specified)
- moveInSpecials: Any move-in specials/concessions mentioned for this unit type (null if none)

Also extract:
- propertySpecials: Any property-wide specials or promotions mentioned
- confidence: Your confidence in the extraction accuracy (0.0 to 1.0)
- rawDataQuality: Assessment of data quality - "high" (clear pricing tables), "medium" (some ambiguity), "low" (very fragmented)
- notes: Any relevant notes about the extraction or data quality issues

Return ONLY valid JSON matching this exact structure:
{
  "units": [...],
  "propertySpecials": "string or null",
  "confidence": 0.85,
  "rawDataQuality": "high",
  "notes": "string or null"
}

Key parsing rules:
1. "Starting at $X" means rentMin = X, rentMax = null
2. "$X - $Y" means rentMin = X, rentMax = Y
3. "Call for details" or "Contact us" means rentMin = null, rentMax = null
4. Square footage like "598 Sq. Ft." or "1,094 Sq. Ft." should be parsed as numbers (598, 1094)
5. Floor plan codes often appear before bed/bath info (e.g., "A1 1 Bed 1 Bath")
6. "Studio" = 0 bedrooms
7. Look for patterns like "Specials Available" or specific promotional text

PASTED CONTENT TO ANALYZE:
`

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { content, propertyId, action } = body

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }

    if (content.length < 50) {
      return NextResponse.json({ 
        error: 'Content too short - please paste more floor plan/pricing information' 
      }, { status: 400 })
    }

    if (content.length > 50000) {
      return NextResponse.json({ 
        error: 'Content too long - please paste a smaller portion of the page' 
      }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // Call GPT-4o-mini for extraction
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a precise data extraction assistant. Always respond with valid JSON only, no markdown formatting or explanation text.' 
        },
        { 
          role: 'user', 
          content: EXTRACTION_PROMPT + content 
        }
      ],
      temperature: 0.1, // Low temperature for consistent extraction
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })

    const responseText = completion.choices[0].message.content || '{}'
    
    let extractionResult: ExtractionResult
    try {
      extractionResult = JSON.parse(responseText)
    } catch (parseError) {
      console.error('Failed to parse LLM response:', responseText)
      return NextResponse.json({ 
        error: 'Failed to parse extraction results' 
      }, { status: 500 })
    }

    // Validate the extraction result
    if (!extractionResult.units || !Array.isArray(extractionResult.units)) {
      return NextResponse.json({ 
        error: 'No unit data could be extracted from the content',
        details: extractionResult
      }, { status: 422 })
    }

    // Clean and validate extracted units
    const validatedUnits = extractionResult.units
      .filter(unit => unit.unitType && typeof unit.bedrooms === 'number')
      .map(unit => ({
        unitType: String(unit.unitType).trim(),
        bedrooms: Math.max(0, Math.floor(Number(unit.bedrooms) || 0)),
        bathrooms: Math.max(1, Number(unit.bathrooms) || 1),
        sqftMin: unit.sqftMin ? Math.floor(Number(unit.sqftMin)) : null,
        sqftMax: unit.sqftMax ? Math.floor(Number(unit.sqftMax)) : null,
        rentMin: unit.rentMin ? Math.floor(Number(unit.rentMin)) : null,
        rentMax: unit.rentMax ? Math.floor(Number(unit.rentMax)) : null,
        availableCount: Math.max(0, Math.floor(Number(unit.availableCount) || 0)),
        moveInSpecials: unit.moveInSpecials || null
      }))

    // If action is 'save', save to database
    if (action === 'save') {
      const savedUnits = await saveExtractedUnits(supabase, propertyId, validatedUnits)
      
      // Create or update knowledge_sources entry for manual pricing
      const { data: existingSource } = await supabase
        .from('knowledge_sources')
        .select('id')
        .eq('property_id', propertyId)
        .eq('source_type', 'manual')
        .eq('source_name', 'Manual Pricing Entry')
        .single()

      if (existingSource) {
        // Update existing entry
        await supabase
          .from('knowledge_sources')
          .update({
            documents_created: savedUnits.length,
            extracted_data: {
              unit_types: validatedUnits.map(u => u.unitType),
              total_units: validatedUnits.length,
              property_specials: extractionResult.propertySpecials
            },
            last_synced_at: new Date().toISOString(),
            status: 'completed'
          })
          .eq('id', existingSource.id)
      } else {
        // Create new entry
        await supabase
          .from('knowledge_sources')
          .insert({
            property_id: propertyId,
            source_type: 'manual',
            source_name: 'Manual Pricing Entry',
            status: 'completed',
            documents_created: savedUnits.length,
            extracted_data: {
              unit_types: validatedUnits.map(u => u.unitType),
              total_units: validatedUnits.length,
              property_specials: extractionResult.propertySpecials
            },
            last_synced_at: new Date().toISOString()
          })
      }

      // Sync units to knowledge base for chatbot RAG
      const syncResult = await syncPropertyUnitsToKnowledgeBase(propertyId)
      if (!syncResult.success) {
        console.warn('Failed to sync units to KB:', syncResult.error)
        // Don't fail the save if KB sync fails
      }

      return NextResponse.json({
        success: true,
        action: 'saved',
        units: savedUnits,
        totalExtracted: validatedUnits.length,
        totalSaved: savedUnits.length,
        propertySpecials: extractionResult.propertySpecials,
        confidence: extractionResult.confidence,
        rawDataQuality: extractionResult.rawDataQuality,
        notes: extractionResult.notes
      })
    }

    // Otherwise just return the preview
    return NextResponse.json({
      success: true,
      action: 'preview',
      units: validatedUnits,
      totalExtracted: validatedUnits.length,
      propertySpecials: extractionResult.propertySpecials,
      confidence: extractionResult.confidence,
      rawDataQuality: extractionResult.rawDataQuality,
      notes: extractionResult.notes
    })

  } catch (error) {
    console.error('Property Extract Pricing Error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

async function saveExtractedUnits(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  units: ExtractedUnit[]
) {
  const savedUnits = []

  for (const unit of units) {
    // Check if unit type already exists for this property
    const { data: existingUnit } = await supabase
      .from('property_units')
      .select('id, rent_min, rent_max, available_count')
      .eq('property_id', propertyId)
      .eq('unit_type', unit.unitType)
      .single()

    if (existingUnit) {
      // Update existing unit
      const { data: updatedUnit, error } = await supabase
        .from('property_units')
        .update({
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          sqft_min: unit.sqftMin,
          sqft_max: unit.sqftMax,
          rent_min: unit.rentMin,
          rent_max: unit.rentMax,
          available_count: unit.availableCount,
          move_in_specials: unit.moveInSpecials,
          source: 'manual',
          last_updated_at: new Date().toISOString()
        })
        .eq('id', existingUnit.id)
        .select()
        .single()

      if (!error && updatedUnit) {
        savedUnits.push(formatUnit(updatedUnit))

        // Record price history if rent changed
        const priceChanged = 
          existingUnit.rent_min !== unit.rentMin ||
          existingUnit.rent_max !== unit.rentMax

        if (priceChanged || existingUnit.available_count !== unit.availableCount) {
          await supabase.from('property_price_history').insert({
            property_unit_id: existingUnit.id,
            rent_min: unit.rentMin,
            rent_max: unit.rentMax,
            available_count: unit.availableCount,
            source: 'ai_extraction'
          })
        }
      }
    } else {
      // Insert new unit
      const { data: newUnit, error } = await supabase
        .from('property_units')
        .insert({
          property_id: propertyId,
          unit_type: unit.unitType,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          sqft_min: unit.sqftMin,
          sqft_max: unit.sqftMax,
          rent_min: unit.rentMin,
          rent_max: unit.rentMax,
          available_count: unit.availableCount,
          move_in_specials: unit.moveInSpecials,
          source: 'manual'
        })
        .select()
        .single()

      if (!error && newUnit) {
        savedUnits.push(formatUnit(newUnit))

        // Record initial price history
        if (unit.rentMin || unit.rentMax) {
          await supabase.from('property_price_history').insert({
            property_unit_id: newUnit.id,
            rent_min: unit.rentMin,
            rent_max: unit.rentMax,
            available_count: unit.availableCount,
            source: 'ai_extraction'
          })
        }
      }
    }
  }

  return savedUnits
}

function formatUnit(data: Record<string, unknown>) {
  return {
    id: data.id as string,
    propertyId: data.property_id as string,
    unitType: data.unit_type as string,
    bedrooms: data.bedrooms as number,
    bathrooms: data.bathrooms as number,
    sqftMin: data.sqft_min as number | null,
    sqftMax: data.sqft_max as number | null,
    rentMin: data.rent_min as number | null,
    rentMax: data.rent_max as number | null,
    availableCount: data.available_count as number || 0,
    moveInSpecials: data.move_in_specials as string | null,
    lastUpdatedAt: data.last_updated_at as string
  }
}

