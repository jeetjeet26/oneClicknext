import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'

// Define the schema that OpenAI will use to generate SQL
const DATABASE_SCHEMA = `
Table: fact_marketing_performance
Columns:
  - date (DATE): The date of the marketing data
  - property_id (UUID): The property this data belongs to
  - channel_id (TEXT): The marketing channel ('meta', 'google_ads', 'ga4')
  - campaign_name (TEXT): Name of the campaign
  - campaign_id (TEXT): Unique identifier for the campaign
  - impressions (INTEGER): Number of ad impressions
  - clicks (INTEGER): Number of clicks
  - spend (DECIMAL): Amount spent in USD
  - conversions (INTEGER): Number of conversions

Common calculations:
  - CTR (Click Through Rate) = (clicks / impressions) * 100
  - CPC (Cost Per Click) = spend / clicks
  - CPA (Cost Per Acquisition) = spend / conversions
  - Conversion Rate = (conversions / clicks) * 100
`

const SYSTEM_PROMPT = `You are a SQL query generator for a marketing analytics database.
Given a natural language question, generate a PostgreSQL query.

${DATABASE_SCHEMA}

Rules:
1. ALWAYS filter by property_id using the provided value
2. Only SELECT data, never INSERT/UPDATE/DELETE
3. Use aggregate functions (SUM, AVG, COUNT) for totals
4. Format dates using DATE_TRUNC for grouping
5. Limit results to 100 rows max
6. Return clean column aliases for display
7. Handle division by zero with NULLIF

Return ONLY the SQL query, no explanation.`

// Allowed SQL operations for safety
const ALLOWED_OPERATIONS = ['SELECT']
const BLOCKED_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE']

function validateSQL(sql: string): { valid: boolean; error?: string } {
  const upperSQL = sql.toUpperCase().trim()
  
  // Check if it starts with SELECT
  if (!ALLOWED_OPERATIONS.some(op => upperSQL.startsWith(op))) {
    return { valid: false, error: 'Only SELECT queries are allowed' }
  }
  
  // Check for blocked keywords
  for (const keyword of BLOCKED_KEYWORDS) {
    if (upperSQL.includes(keyword)) {
      return { valid: false, error: `Query contains blocked keyword: ${keyword}` }
    }
  }
  
  // Check for multiple statements (allow at most one trailing semicolon)
  const withoutTrailing = sql.trim().replace(/;+\s*$/, '')
  if (withoutTrailing.includes(';')) {
    return { valid: false, error: 'Multiple SQL statements not allowed' }
  }

  // Enforce tenant filter presence.
  if (!upperSQL.includes('PROPERTY_ID')) {
    return { valid: false, error: 'Query must include a property_id filter' }
  }
  
  return { valid: true }
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { question, propertyId } = await req.json()

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // Generate SQL from natural language
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'user', 
          content: `Property ID to filter by: ${propertyId}\n\nQuestion: ${question}` 
        }
      ],
      temperature: 0.1, // Low temperature for consistent SQL
      max_tokens: 500,
    })

    const generatedSQL = completion.choices[0].message.content?.trim()

    if (!generatedSQL) {
      return NextResponse.json({ 
        error: 'Failed to generate SQL query' 
      }, { status: 500 })
    }

    // Clean SQL (remove markdown code blocks if present)
    const cleanSQL = generatedSQL
      .replace(/```sql\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim()

    // Validate the SQL
    const validation = validateSQL(cleanSQL)
    if (!validation.valid) {
      return NextResponse.json({ 
        error: validation.error,
        generatedSQL: cleanSQL 
      }, { status: 400 })
    }

    // Execute the query using service client
    const supabase = createServiceClient()
    
    // Use Supabase's rpc for raw SQL or the query builder
    // For safety, we'll use a raw query through the REST API
    const { data, error } = await supabase.rpc('execute_readonly_query', {
      query_text: cleanSQL
    })

    // If the RPC doesn't exist, fall back to direct execution
    // This requires the execute_readonly_query function to exist in Supabase
    if (error?.message?.includes('function') || error?.code === '42883') {
      // Fallback: Execute directly on fact_marketing_performance
      // This is less flexible but safer
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('fact_marketing_performance')
        .select('*')
        .eq('property_id', propertyId)
        .limit(100)

      if (fallbackError) {
        return NextResponse.json({ 
          error: 'Query execution failed',
          details: fallbackError.message,
          generatedSQL: cleanSQL
        }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        question,
        sql: cleanSQL,
        data: fallbackData,
        rowCount: fallbackData?.length || 0,
        note: 'Using fallback query - install execute_readonly_query function for full NL-SQL support'
      })
    }

    if (error) {
      return NextResponse.json({ 
        error: 'Query execution failed',
        details: error.message,
        generatedSQL: cleanSQL
      }, { status: 500 })
    }

    const resultRows = Array.isArray(data) ? data : []

    return NextResponse.json({
      success: true,
      question,
      sql: cleanSQL,
      data: resultRows,
      rowCount: resultRows.length,
    })

  } catch (error) {
    console.error('NL-to-SQL API Error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Server error' 
    }, { status: 500 })
  }
}

