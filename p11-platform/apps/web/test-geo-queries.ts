/**
 * GEO Query Strategy Testing
 * Tests different query types against actual LLM APIs to analyze results
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// Test queries - comparing generic vs specific
const testQueries = {
  generic: [
    'Best apartments in San Diego',
    'Top rated apartments San Diego',
    'Luxury apartments San Diego',
    'Pet friendly apartments in San Diego',
  ],
  specific: [
    'Modern apartments near UCSD with rooftop pool',
    'Newly built luxury apartments in Kearny Mesa with EV charging',
    'Dog-friendly apartments in Mission Valley under $3000',
    'Apartments with smart home tech in San Diego tech corridor',
  ],
  branded: [
    'What is AMLI Aero?',
    'Is AMLI Aero a good place to live?',
    'AMLI Aero reviews',
  ],
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Schema for structured responses
const responseSchema = {
  type: 'object' as const,
  properties: {
    ordered_entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
          rationale: { type: 'string' },
          position: { type: 'number' },
        },
        required: ['name', 'domain', 'rationale', 'position'],
      },
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          domain: { type: 'string' },
        },
        required: ['url', 'domain'],
      },
    },
    answer_summary: { type: 'string' },
  },
  required: ['ordered_entities', 'citations', 'answer_summary'],
}

const systemPrompt = `You are a helpful AI assistant answering apartment rental questions for San Diego.

When asked about apartments or places to live, provide specific property recommendations with their websites/domains.

Return your response in this JSON format:
{
  "ordered_entities": [
    {
      "name": "Property Name",
      "domain": "propertywebsite.com",
      "rationale": "Why this property is relevant",
      "position": 1
    }
  ],
  "citations": [
    {
      "url": "https://source.com/article",
      "domain": "source.com"
    }
  ],
  "answer_summary": "Your answer here"
}

IMPORTANT: 
- List specific apartment communities, NOT just aggregator sites
- Include both individual properties AND listing sites
- Position 1 is the most relevant
- Provide at least 3-5 entities per query`

async function testClaudeQuery(query: string) {
  console.log(`\n🔍 Testing Claude: "${query}"`)
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: query,
        },
      ],
    })

    const content = response.content[0]
    if (content.type === 'text') {
      const parsed = JSON.parse(content.text)
      console.log('✓ Entities returned:')
      parsed.ordered_entities.forEach((entity: any, idx: number) => {
        console.log(`  ${idx + 1}. ${entity.name} (${entity.domain})`)
      })
      return parsed
    }
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

async function testOpenAIQuery(query: string) {
  console.log(`\n🔍 Testing OpenAI: "${query}"`)
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      response_format: { type: 'json_object' },
    })

    const parsed = JSON.parse(response.choices[0].message.content || '{}')
    console.log('✓ Entities returned:')
    parsed.ordered_entities?.forEach((entity: any, idx: number) => {
      console.log(`  ${idx + 1}. ${entity.name} (${entity.domain})`)
    })
    return parsed
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

async function runTests() {
  console.log('='.repeat(80))
  console.log('GEO QUERY STRATEGY ANALYSIS')
  console.log('='.repeat(80))

  console.log('\n📊 HYPOTHESIS:')
  console.log('Generic queries like "Best apartments in San Diego" will return:')
  console.log('  - Mostly aggregator sites (apartments.com, zillow.com, rent.com)')
  console.log('  - Few specific properties')
  console.log('')
  console.log('Specific queries with amenities + location will return:')
  console.log('  - Mix of specific properties AND aggregators')
  console.log('  - Better chance for individual properties to rank')

  // Test generic queries
  console.log('\n' + '='.repeat(80))
  console.log('TESTING GENERIC QUERIES (Current Strategy)')
  console.log('='.repeat(80))
  
  for (const query of testQueries.generic) {
    await testClaudeQuery(query)
    await new Promise(resolve => setTimeout(resolve, 1000)) // Rate limiting
  }

  // Test specific queries
  console.log('\n' + '='.repeat(80))
  console.log('TESTING SPECIFIC QUERIES (Proposed Strategy)')
  console.log('='.repeat(80))
  
  for (const query of testQueries.specific) {
    await testClaudeQuery(query)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // Test branded queries
  console.log('\n' + '='.repeat(80))
  console.log('TESTING BRANDED QUERIES (Current Strategy - Good!)')
  console.log('='.repeat(80))
  
  for (const query of testQueries.branded) {
    await testClaudeQuery(query)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log('\n' + '='.repeat(80))
  console.log('ANALYSIS COMPLETE')
  console.log('='.repeat(80))
}

// Run tests
runTests().catch(console.error)
