import { describe, expect, it } from 'vitest'
import {
  contextRevisionFixture,
  generatedContextWithoutUploadsFixture,
  staleContextFixture,
  unifiedKnowledgeSourcesFixture,
} from './fixtures/unified-property-knowledge.fixture'
import {
  classifyKnowledgeSource,
  getSourceTypeLabel,
  presentChatbotContext,
  presentKnowledgeSource,
  presentRevisionIdentity,
} from './knowledge-presentation'

describe('knowledge source presentation', () => {
  it('classifies known generated and uploaded sources without guessing unknown origins', () => {
    expect(classifyKnowledgeSource(unifiedKnowledgeSourcesFixture[0])).toBe('generated')
    expect(classifyKnowledgeSource(unifiedKnowledgeSourcesFixture[1])).toBe('generated')
    expect(classifyKnowledgeSource(unifiedKnowledgeSourcesFixture[2])).toBe('generated')
    expect(classifyKnowledgeSource(unifiedKnowledgeSourcesFixture[3])).toBe('uploaded')
    expect(classifyKnowledgeSource(unifiedKnowledgeSourcesFixture[4])).toBeNull()
  })

  it('requires SiteForge artifact evidence before classifying an integration as generated', () => {
    expect(classifyKnowledgeSource({
      id: 'siteforge-without-artifact',
      source_type: 'integration',
      source_name: 'SiteForge sync',
      status: 'completed',
      extracted_data: { generated_by: 'siteforge' },
    })).toBeNull()
  })

  it('presents only available operational and provenance metadata', () => {
    const brandBook = presentKnowledgeSource(unifiedKnowledgeSourcesFixture[0])
    expect(brandBook).toMatchObject({
      origin: 'generated',
      sourceTypeLabel: 'BrandForge Brand Book',
      lastSuccessfulAt: '2026-08-03T18:00:00.000Z',
      lastAttemptAt: null,
      ingestionVersion: '3',
      documentCount: 6,
      identities: [{ label: 'Brand asset', value: 'brand-asset-42' }],
    })

    const upload = presentKnowledgeSource(unifiedKnowledgeSourcesFixture[3])
    expect(upload.lastSuccessfulAt).toBeNull()
    expect(upload.lastAttemptAt).toBe('2026-08-04T16:00:00.000Z')
    expect(upload.identities).toEqual([{ label: 'Ingestion run', value: 'upload-run-9' }])
  })

  it('preserves unfamiliar source types instead of relabeling their data', () => {
    expect(getSourceTypeLabel('partner_feed')).toBe('Partner Feed')
  })
})

describe('chatbot context presentation', () => {
  it('explains generated context with no uploaded document chunks', () => {
    const presentation = presentChatbotContext(generatedContextWithoutUploadsFixture)
    expect(presentation).toMatchObject({
      lifecycleLabel: 'Current',
      reviewLabel: 'No review pending',
      sourceIds: ['source-brand-book', 'source-onboarding'],
      documentCount: 0,
      hasGeneratedContext: true,
      identity: 'context-1 · version 4',
    })
    expect(presentation.availabilityExplanation).toContain('no uploaded document chunks')
  })

  it('surfaces stale and review-required state independently', () => {
    expect(presentChatbotContext(staleContextFixture)).toMatchObject({
      lifecycleLabel: 'Stale',
      reviewLabel: 'Review required',
    })
  })

  it('presents revision and source identities without fabricating missing values', () => {
    expect(presentRevisionIdentity(contextRevisionFixture)).toEqual({
      id: 'revision-5',
      changedSourceIds: ['source-brand-book'],
      removedSourceIds: ['source-old'],
      model: 'deterministic-context-builder',
    })
  })
})
