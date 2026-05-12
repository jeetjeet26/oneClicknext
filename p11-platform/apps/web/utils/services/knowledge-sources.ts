import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { editPropertyChatbotContext } from './chatbot-context-editor'

type KnowledgeSourceStatus = 'pending' | 'processing' | 'completed' | 'failed'

type UpsertManagedKnowledgeSourceInput = {
  propertyId: string
  sourceType: string
  sourceName: string
  sourceUrl?: string | null
  fileName?: string | null
  fileType?: string | null
  fileSize?: number | null
  status?: KnowledgeSourceStatus
  documentsCreated?: number | null
  extractedData?: Json | null
  processingNotes?: string | null
  errorMessage?: string | null
}

export async function upsertManagedKnowledgeSource(
  supabase: SupabaseClient<Database>,
  input: UpsertManagedKnowledgeSourceInput
): Promise<{ id: string }> {
  let selectQuery = supabase
    .from('knowledge_sources')
    .select('id')
    .eq('property_id', input.propertyId)
    .eq('source_type', input.sourceType)
    .eq('source_name', input.sourceName)

  if (input.sourceUrl) {
    selectQuery = selectQuery.eq('source_url', input.sourceUrl)
  } else {
    selectQuery = selectQuery.is('source_url', null)
  }

  const { data: existingSource, error: existingSourceError } = await selectQuery.maybeSingle()
  if (existingSourceError) {
    throw existingSourceError
  }

  const payload = {
    property_id: input.propertyId,
    source_type: input.sourceType,
    source_name: input.sourceName,
    source_url: input.sourceUrl ?? null,
    file_name: input.fileName ?? null,
    file_type: input.fileType ?? null,
    file_size: input.fileSize ?? null,
    status: input.status ?? 'completed',
    documents_created: input.documentsCreated ?? 0,
    extracted_data: input.extractedData ?? null,
    processing_notes: input.processingNotes ?? null,
    error_message: input.errorMessage ?? null,
    last_synced_at: new Date().toISOString(),
  }

  if (existingSource?.id) {
    const { data: updatedSource, error: updateError } = await supabase
      .from('knowledge_sources')
      .update(payload)
      .eq('id', existingSource.id)
      .select('id')
      .single()

    if (updateError || !updatedSource) {
      throw updateError ?? new Error('Failed to update managed knowledge source')
    }

    try {
      const contextResult = await editPropertyChatbotContext(supabase, input.propertyId, {
        changeSummary: `Updated chatbot source: ${input.sourceName}`,
        changedSourceIds: [updatedSource.id],
        requiresReview: false,
        mode: 'source_change',
      })
      if (!contextResult.success) {
        console.error('[KnowledgeSources] Chatbot context edit failed:', contextResult.error)
      }
    } catch (contextError) {
      console.error('[KnowledgeSources] Chatbot context edit failed:', contextError)
    }

    return { id: updatedSource.id }
  }

  const { data: createdSource, error: createError } = await supabase
    .from('knowledge_sources')
    .insert(payload)
    .select('id')
    .single()

  if (createError || !createdSource) {
    throw createError ?? new Error('Failed to create managed knowledge source')
  }

  try {
    const contextResult = await editPropertyChatbotContext(supabase, input.propertyId, {
      changeSummary: `Added chatbot source: ${input.sourceName}`,
      changedSourceIds: [createdSource.id],
      requiresReview: false,
      mode: 'source_change',
    })
    if (!contextResult.success) {
      console.error('[KnowledgeSources] Chatbot context edit failed:', contextResult.error)
    }
  } catch (contextError) {
    console.error('[KnowledgeSources] Chatbot context edit failed:', contextError)
  }

  return { id: createdSource.id }
}
