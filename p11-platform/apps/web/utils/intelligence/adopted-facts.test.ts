import {describe,expect,it} from 'vitest'
import {factSchema,factUsable,type Document} from './contracts'

// Synthetic fixtures exercise PostgreSQL deterministic UUIDs, including values
// outside RFC version-bit restrictions. No production records belong in tests.
const fields=['short_description','features_detail','faqs','structured_facts','restricted_claims'] as const
describe('adopted fact editor compatibility',()=>{
  for(const field of fields)it(`keeps ${field} editable with source provenance`,()=>{
    const payload={field,value:'Reviewed fixture information.',source:'Synthetic review',sourceUrl:'https://example.com/community/',observedAt:'2026-10-15',effectiveFrom:'2026-10-15',effectiveTo:null,reviewAfter:'2026-11-14',confidence:null,origin:'import' as const,visibility:'public' as const,sourceEvidenceId:'11111111-1111-c111-1111-111111111111',sourceHash:'a'.repeat(64)}
    expect(factSchema.parse(payload)).toEqual(payload)
    const document={id:'22222222-2222-4222-8222-222222222222',kind:'fact',status:'approved',key:field,payload} as Document
    expect(factUsable(document,'public','2026-10-15')).toBe(true)
    expect(factUsable(document,'public','2026-11-15')).toBe(false)
  })
})
