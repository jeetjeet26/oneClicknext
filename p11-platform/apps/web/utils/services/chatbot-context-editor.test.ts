import { beforeEach, describe, expect, it } from 'vitest'
import { editPropertyChatbotContext, loadPropertyChatbotContext, saveManualPropertyChatbotContext } from './chatbot-context-editor'

class QueryBuilder {
  private filters: Record<string, unknown> = {}
  private operation: 'select' | 'upsert' | 'insert' | 'update' = 'select'
  private upsertPayload: unknown = null

  constructor(
    private table: string,
    private db: MockDb
  ) {}

  select() {
    this.operation = 'select'
    return this
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  upsert(payload: unknown) {
    this.operation = 'upsert'
    this.upsertPayload = payload
    if (this.table === 'property_chatbot_contexts') {
      const record = Array.isArray(payload) ? payload[0] : payload
      this.db.context = {
        ...(this.db.context ?? {}),
        ...(record as Record<string, unknown>),
        id: this.db.context?.id ?? 'context-1',
        created_at: this.db.context?.created_at ?? '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      }
    }
    return this
  }

  update(payload: unknown) {
    this.operation = 'update'
    if (this.table === 'property_chatbot_contexts') {
      this.db.context = {
        ...(this.db.context ?? {}),
        ...(payload as Record<string, unknown>),
      }
    }
    return this
  }

  insert(payload: unknown) {
    this.operation = 'insert'
    if (this.table === 'property_chatbot_context_revisions') {
      this.db.revisions.push(payload)
    }
    return Promise.resolve({ data: payload, error: null })
  }

  single() {
    if (this.table === 'properties') return Promise.resolve({ data: this.db.property, error: null })
    if (this.table === 'property_chatbot_contexts') {
      return Promise.resolve({ data: { id: this.db.context?.id ?? 'context-1' }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }

  maybeSingle() {
    if (this.table === 'property_chatbot_contexts') {
      return Promise.resolve({ data: this.db.context, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }

  then(resolve: (value: { data: unknown; error: null }) => void) {
    if (this.operation === 'upsert' || this.operation === 'update') {
      resolve({ data: this.upsertPayload, error: null })
      return
    }

    if (this.table === 'property_units') {
      resolve({ data: this.db.units, error: null })
      return
    }
    if (this.table === 'knowledge_sources') {
      resolve({ data: this.db.sources, error: null })
      return
    }
    if (this.table === 'documents') {
      resolve({ data: this.db.documents, error: null })
      return
    }

    resolve({ data: null, error: null })
  }
}

type MockDb = {
  property: Record<string, unknown>
  units: Record<string, unknown>[]
  sources: Record<string, unknown>[]
  documents: Record<string, unknown>[]
  context: Record<string, unknown> | null
  revisions: unknown[]
}

function createMockSupabase(overrides: Partial<MockDb> = {}) {
  const db: MockDb = {
    property: {
      id: 'property-1',
      name: 'Acacia',
      address: null,
      property_type: 'multifamily',
      website_url: 'https://acacia.example',
      unit_count: null,
      year_built: null,
      amenities: ['Pool'],
      pet_policy: { petsAllowed: true },
      parking_info: { garage: true },
      special_features: ['Rooftop deck'],
      brand_voice: 'Warm and professional',
      target_audience: 'Renters',
      office_hours: { monday: '9-5' },
    },
    units: [],
    sources: [],
    documents: [],
    context: null,
    revisions: [],
    ...overrides,
  }

  return {
    db,
    supabase: {
      from: (table: string) => new QueryBuilder(table, db),
    },
  }
}

describe('chatbot context editor', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('adds a new floorplan and pricing item to generated context', async () => {
    const { db, supabase } = createMockSupabase({
      units: [{
        id: 'unit-a1',
        property_id: 'property-1',
        unit_type: 'A1',
        bedrooms: 1,
        bathrooms: 1,
        sqft_min: 700,
        sqft_max: 700,
        rent_min: 2100,
        rent_max: null,
        deposit: null,
        available_count: 3,
        move_in_specials: null,
        last_updated_at: '2026-05-11T00:00:00.000Z',
        created_at: '2026-05-11T00:00:00.000Z',
        source: 'website',
        source_url: 'https://acacia.example/floorplans',
      }],
    })

    const result = await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Added A1 floorplan.',
    })

    expect(result.success).toBe(true)
    expect(db.context?.context_markdown).toContain('A1')
    expect(db.context?.context_markdown).toContain('$2,100')
    expect(db.context?.context_markdown).toContain('CONCIERGE RESPONSE STYLE')
    expect(db.context?.context_markdown).toContain('professional property manager or leasing concierge')
    expect(db.revisions).toHaveLength(1)
  })

  it('renders sale pricing (not rent) for for-sale residential properties', async () => {
    const { db, supabase } = createMockSupabase({
      property: {
        id: 'property-1',
        name: 'Acacia',
        address: null,
        property_type: 'master_planned',
        website_url: 'https://acacia.example',
        unit_count: null,
        year_built: null,
        amenities: [],
        pet_policy: null,
        parking_info: null,
        special_features: [],
        brand_voice: null,
        target_audience: null,
        office_hours: null,
      },
      units: [{
        id: 'unit-plan4',
        property_id: 'property-1',
        unit_type: 'Plan 4 (Homesite 1)',
        bedrooms: 3,
        bathrooms: 2.5,
        sqft_min: 2040,
        sqft_max: 2040,
        rent_min: 2595000,
        rent_max: null,
        deposit: null,
        available_count: 1,
        move_in_specials: 'Estimated move-in May 2026.',
        last_updated_at: '2026-07-23T00:00:00.000Z',
        created_at: '2026-07-23T00:00:00.000Z',
        source: 'manual',
        source_url: null,
      }],
    })

    const result = await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Added Plan 4 homesite.',
    })

    expect(result.success).toBe(true)
    expect(db.context?.context_markdown).toContain('price $2,595,000')
    expect(db.context?.context_markdown).not.toContain('rent $2,595,000')
    expect(db.context?.context_markdown).toContain('Details: Estimated move-in May 2026.')
  })

  it('updates an existing price from current structured units', async () => {
    const { db, supabase } = createMockSupabase({
      context: {
        id: 'context-1',
        property_id: 'property-1',
        context_markdown: 'A1 rent $2,100',
        context_json: {},
        version: 1,
      },
      units: [{
        id: 'unit-a1',
        property_id: 'property-1',
        unit_type: 'A1',
        bedrooms: 1,
        bathrooms: 1,
        sqft_min: 700,
        sqft_max: 700,
        rent_min: 2250,
        rent_max: null,
        deposit: null,
        available_count: 2,
        move_in_specials: null,
        last_updated_at: '2026-05-11T00:00:00.000Z',
        created_at: '2026-05-11T00:00:00.000Z',
        source: 'website',
        source_url: 'https://acacia.example/floorplans',
      }],
    })

    await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Updated A1 price.',
    })

    expect(db.context?.context_markdown).toContain('$2,250')
    expect(db.context?.context_markdown).not.toContain('$2,100')
  })

  it('removes outdated listings from the same source when current units no longer include them', async () => {
    const { db, supabase } = createMockSupabase({
      context: {
        id: 'context-1',
        property_id: 'property-1',
        context_markdown: 'A1 and B2 were listed',
        context_json: {},
        version: 1,
      },
      units: [{
        id: 'unit-a1',
        property_id: 'property-1',
        unit_type: 'A1',
        bedrooms: 1,
        bathrooms: 1,
        sqft_min: null,
        sqft_max: null,
        rent_min: 2200,
        rent_max: null,
        deposit: null,
        available_count: 1,
        move_in_specials: null,
        last_updated_at: null,
        created_at: null,
        source: 'website',
        source_url: 'https://acacia.example/floorplans',
      }],
    })

    await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Website floorplans refreshed.',
      mode: 'source_change',
    })

    expect(db.context?.context_markdown).toContain('A1')
    expect(db.context?.context_markdown).not.toContain('B2')
  })

  it('preserves facts from unrelated active sources in source summary', async () => {
    const { db, supabase } = createMockSupabase({
      sources: [{
        id: 'source-faq',
        property_id: 'property-1',
        source_type: 'document',
        source_name: 'FAQ Upload',
        source_url: null,
        status: 'completed',
        extracted_data: { faq: [{ question: 'Do you allow pets?', answer: 'Yes.' }] },
        last_synced_at: '2026-05-11T00:00:00.000Z',
      }],
    })

    await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Pricing source changed.',
    })

    expect(JSON.stringify(db.context?.context_json)).toContain('FAQ Upload')
    expect(JSON.stringify(db.context?.context_json)).toContain('Do you allow pets?')
  })

  it('extracts FAQ entries from pasted FAQ document chunks', async () => {
    const { db, supabase } = createMockSupabase({
      documents: [{
        id: 'doc-faq-1',
        content: 'Q. How much are the HOA dues? A. HOA dues are currently estimated around $810 per home per month. Q. What are the designated schools? A. Acacia is in the Palo Alto Unified School District.',
        metadata: { title: 'FAQ', source: 'pasted_text', source_type: 'manual' },
        created_at: '2026-05-11T00:00:00.000Z',
        original_file_name: null,
      }],
    })

    await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Added FAQ upload.',
    })

    expect(db.context?.context_markdown).toContain('Q: How much are the HOA dues?')
    expect(db.context?.context_markdown).toContain('HOA dues are currently estimated around $810')
    expect(db.context?.context_markdown).toContain('What are the designated schools?')
  })

  it('marks low-confidence edits for review', async () => {
    const { db, supabase } = createMockSupabase()

    const result = await editPropertyChatbotContext(supabase as never, 'property-1', {
      changeSummary: 'Messy policy upload needs review.',
      requiresReview: true,
    })

    expect(result.status).toBe('needs_review')
    expect(db.context?.requires_review).toBe(true)
    expect(db.context?.context_markdown).toContain('Recent source changes require operator review.')
  })

  it('loads an existing generated context for chat runtime', async () => {
    const { supabase } = createMockSupabase({
      context: {
        id: 'context-1',
        property_id: 'property-1',
        status: 'current',
        context_markdown: 'CLIENT PROPERTY CONTEXT',
        context_json: {},
        requires_review: false,
      },
    })

    const context = await loadPropertyChatbotContext(supabase as never, 'property-1')

    expect(context?.contextMarkdown).toBe('CLIENT PROPERTY CONTEXT')
    expect(context?.status).toBe('current')
  })

  it('saves manual markdown edits without regenerating source facts', async () => {
    const { db, supabase } = createMockSupabase({
      context: {
        id: 'context-1',
        property_id: 'property-1',
        status: 'stale',
        context_markdown: 'Old generated context',
        context_json: { property_profile: { name: 'Acacia' } },
        version: 2,
        requires_review: true,
      },
    })

    const result = await saveManualPropertyChatbotContext(supabase as never, 'property-1', {
      contextMarkdown: 'Manually edited context',
    })

    expect(result).toEqual({ success: true, status: 'current' })
    expect(db.context?.context_markdown).toBe('Manually edited context')
    expect(db.context?.status).toBe('current')
    expect(db.context?.version).toBe(3)
    expect(db.context?.requires_review).toBe(false)
    expect(db.context?.last_change_summary).toBe('Manual chatbot context edit saved.')
    expect(db.revisions).toHaveLength(1)
  })

  it('does not create a manual context when none exists', async () => {
    const { db, supabase } = createMockSupabase()

    const result = await saveManualPropertyChatbotContext(supabase as never, 'property-1', {
      contextMarkdown: 'Manual context',
    })

    expect(result).toEqual({
      success: false,
      status: 'failed',
      error: 'Chatbot context not found',
    })
    expect(db.context).toBeNull()
    expect(db.revisions).toHaveLength(0)
  })
})
