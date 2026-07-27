/**
 * GEO Query Strategy Testing
 * Tests different query types against actual LLM APIs to analyze results
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local manually
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '.env.local')
    const envContent = readFileSync(envPath, 'utf8')
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=')
        const value = valueParts.join('=')
        if (key && value) {
          process.env[key] = value
        }
      }
    })
  } catch (err) {
    console.error('Error loading .env.local:', err.message)
  }
}

loadEnv()

// Test queries - comparing generic vs specific
const testQueries = {
  generic: [
    'Best apartments in San Diego',
    'Luxury apartments San Diego',
  ],
  specific: [
    'Modern apartments near UCSD with rooftop pool and pet spa',
    'Dog-friendly apartments in Mission Valley under $3000 with parking',
  ],
  branded: [
    'What is AMLI Aero?',
  ],
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const systemPrompt = `You are a helpful AI assistant answering apartment rental questions for San Diego.

When asked about apartments or places to live, provide specific property recommendations with their websites/domains.

Return your response in this JSON format:
{
  "ordered_entities": [
    {
      "name": "Property Name or Site Name",
      "domain": "website.com",
      "rationale": "Why this property/site is relevant",
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

List at least 5-7 entities. Include both specific apartment communities AND listing/aggregator sites if relevant.`

async function testClaudeQuery(query) {
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
      parsed.ordered_entities.forEach((entity, idx) => {
        console.log(`  ${idx + 1}. ${entity.name} (${entity.domain})`)
        if (entity.rationale) {
          console.log(`     └─ ${entity.rationale.substring(0, 100)}...`)
        }
      })
      
      // Count aggregators vs specific properties
      const aggregators = ['apartments.com', 'zillow.com', 'rent.com', 'realtor.com', 'apartmentlist.com', 'rentcafe.com']
      const aggregatorCount = parsed.ordered_entities.filter(e => 
        aggregators.some(agg => e.domain.includes(agg))
      ).length
      const propertyCount = parsed.ordered_entities.length - aggregatorCount
      
      console.log(`\n   📊 Aggregators: ${aggregatorCount} | Specific Properties: ${propertyCount}`)
      
      return parsed
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

async function testOpenAIQuery(query) {
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
    parsed.ordered_entities?.forEach((entity, idx) => {
      console.log(`  ${idx + 1}. ${entity.name} (${entity.domain})`)
      if (entity.rationale) {
        console.log(`     └─ ${entity.rationale.substring(0, 100)}...`)
      }
    })
    
    // Count aggregators vs specific properties
    const aggregators = ['apartments.com', 'zillow.com', 'rent.com', 'realtor.com', 'apartmentlist.com', 'rentcafe.com']
    const aggregatorCount = (parsed.ordered_entities || []).filter(e => 
      aggregators.some(agg => e.domain.includes(agg))
    ).length
    const propertyCount = (parsed.ordered_entities?.length || 0) - aggregatorCount
    
    console.log(`\n   📊 Aggregators: ${aggregatorCount} | Specific Properties: ${propertyCount}`)
    
    return parsed
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

async function runTests() {
  console.log('='.repeat(80))
  console.log('GEO QUERY STRATEGY ANALYSIS - LIVE API TESTING')
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
  console.log('TEST 1: GENERIC QUERIES (Current Strategy)')
  console.log('='.repeat(80))
  
  for (const query of testQueries.generic) {
    await testClaudeQuery(query)
    await testOpenAIQuery(query)
    await new Promise(resolve => setTimeout(resolve, 2000)) // Rate limiting
  }

  // Test specific queries
  console.log('\n' + '='.repeat(80))
  console.log('TEST 2: SPECIFIC QUERIES (Proposed Strategy)')
  console.log('='.repeat(80))
  
  for (const query of testQueries.specific) {
    await testClaudeQuery(query)
    await testOpenAIQuery(query)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // Test branded queries
  console.log('\n' + '='.repeat(80))
  console.log('TEST 3: BRANDED QUERIES (Current Strategy - Should Be Good)')
  console.log('='.repeat(80))
  
  for (const query of testQueries.branded) {
    await testClaudeQuery(query)
    await testOpenAIQuery(query)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  console.log('\n' + '='.repeat(80))
  console.log('ANALYSIS COMPLETE')
  console.log('='.repeat(80))
  console.log('\nKey Findings:')
  console.log('1. Check ratio of aggregators vs properties in generic queries')
  console.log('2. Check if specific queries return more actual properties')
  console.log('3. Verify branded queries properly return the target property')
}

// Run tests
runTests().catch(console.error)
