/**
 * Utility to sync property_units data to documents table for chatbot RAG
 */

import { createAdminClient } from '@/utils/supabase/admin'
import OpenAI from 'openai'

function formatEmbeddingForPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

export async function syncPropertyUnitsToKnowledgeBase(propertyId: string): Promise<{ success: boolean; document_id?: string; error?: string }> {
  try {
    const adminClient = createAdminClient()
    
    // Get property units
    const { data: units, error: unitsError } = await adminClient
      .from('property_units')
      .select('*')
      .eq('property_id', propertyId)
      .order('bedrooms', { ascending: true })
      .order('unit_type', { ascending: true })
    
    if (unitsError || !units || units.length === 0) {
      return { success: false, error: 'No units found' }
    }

    // Format units into clean, natural language content
    const formatCurrency = (amount: any) => {
      if (!amount) return null
      const num = typeof amount === 'string' ? parseFloat(amount) : amount
      return `$${num.toLocaleString()}`
    }

    const formatSqft = (min: number | null, max: number | null) => {
      if (!min && !max) return null
      if (min === max || !max) return `${min?.toLocaleString()} sq ft`
      return `${min?.toLocaleString()}-${max?.toLocaleString()} sq ft`
    }

    // Group by bedrooms
    const unitsByBedrooms: Record<string, any[]> = {}
    units.forEach(unit => {
      const key = unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} Bedroom`
      if (!unitsByBedrooms[key]) {
        unitsByBedrooms[key] = []
      }
      unitsByBedrooms[key].push(unit)
    })

    // Create formatted content for chatbot
    let formattedContent = 'FLOOR PLANS & PRICING\n\n'
    
    Object.entries(unitsByBedrooms).forEach(([bedroomType, unitsList]) => {
      unitsList.forEach(unit => {
        formattedContent += `${unit.unit_type} - ${bedroomType}\n`
        formattedContent += `${unit.bathrooms} bathroom${unit.bathrooms > 1 ? 's' : ''}`
        
        const sqft = formatSqft(unit.sqft_min, unit.sqft_max)
        if (sqft) {
          formattedContent += `, ${sqft}`
        }
        
        const rentMin = formatCurrency(unit.rent_min)
        const rentMax = formatCurrency(unit.rent_max)
        if (rentMin && rentMax && rentMin !== rentMax) {
          formattedContent += `, Rent: ${rentMin} to ${rentMax} per month`
        } else if (rentMin) {
          formattedContent += `, Rent: ${rentMin} per month`
        }
        
        if (unit.available_count > 0) {
          formattedContent += `, ${unit.available_count} available now`
        }
        
        if (unit.move_in_specials) {
          formattedContent += `\nMove-in Special: ${unit.move_in_specials}`
        }
        
        formattedContent += '\n\n'
      })
    })

    // Add general pricing note
    formattedContent += '\nNote: Pricing and availability are subject to change. Contact us for the most current information and to schedule a tour.\n'

    // Delete old pricing documents
    await adminClient
      .from('documents')
      .delete()
      .eq('property_id', propertyId)
      .eq('metadata->>category', 'pricing')
      .eq('metadata->>source', 'property_units')

    // Generate embedding
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: formattedContent
    })
    const embedding = embeddingResponse.data[0].embedding
    const embeddingVector = formatEmbeddingForPgVector(embedding)

    // Insert formatted document
    const { data: newDoc, error: insertError } = await adminClient
      .from('documents')
      .insert({
        property_id: propertyId,
        content: formattedContent,
        embedding: embeddingVector,
        metadata: {
          title: 'Floor Plans & Pricing',
          category: 'pricing',
          source: 'property_units',
          unit_count: units.length,
          last_updated: new Date().toISOString()
        }
      })
      .select()
      .single()

    if (insertError) {
      return { success: false, error: insertError.message }
    }

    return { success: true, document_id: newDoc.id }
    
  } catch (error: any) {
    console.error('Sync units to KB error:', error)
    return { success: false, error: error.message }
  }
}

