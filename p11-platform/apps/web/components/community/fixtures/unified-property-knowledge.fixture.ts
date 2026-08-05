import type {
  ChatbotContextRecord,
  ChatbotContextRevisionRecord,
  KnowledgeSourceRecord,
} from '../knowledge-presentation'

export const unifiedKnowledgeSourcesFixture: KnowledgeSourceRecord[] = [
  {
    id: 'source-brand-book',
    source_type: 'brand_book',
    source_name: 'Brand Book: Acacia',
    status: 'completed',
    documents_created: 6,
    last_synced_at: '2026-08-03T18:00:00.000Z',
    extracted_data: {
      brand_origin: 'generated_brandforge',
      brand_asset_id: 'brand-asset-42',
      ingestion_version: 3,
    },
  },
  {
    id: 'source-onboarding',
    source_type: 'intake_form',
    source_name: 'Onboarding Intake Form',
    status: 'completed',
    documents_created: 0,
    last_synced_at: '2026-08-03T18:05:00.000Z',
    extracted_data: {},
  },
  {
    id: 'source-siteforge',
    source_type: 'integration',
    source_name: 'Approved website artifact',
    status: 'completed',
    documents_created: 2,
    extracted_data: {
      generated_by: 'siteforge',
      artifact_id: 'artifact-17',
      provenance_identity: 'siteforge:website-7:artifact-17',
    },
  },
  {
    id: 'source-upload',
    source_type: 'document',
    source_name: 'Resident handbook',
    file_name: 'resident-handbook.pdf',
    file_type: 'application/pdf',
    source_url: 'https://files.example/resident-handbook.pdf',
    status: 'failed',
    documents_created: 0,
    error_message: 'The PDF could not be parsed.',
    extracted_data: {
      ingestion_run_id: 'upload-run-9',
      last_attempt_at: '2026-08-04T16:00:00.000Z',
    },
  },
  {
    id: 'source-unknown',
    source_type: 'integration',
    source_name: 'Property management system',
    status: 'completed',
    extracted_data: {},
  },
]

export const generatedContextWithoutUploadsFixture: ChatbotContextRecord = {
  id: 'context-1',
  status: 'current',
  requires_review: false,
  context_markdown: '# Acacia\n\nProperty-generated context.',
  source_ids: ['source-brand-book', 'source-onboarding'],
  source_snapshot: {
    document_count: 0,
  },
  version: 4,
}

export const staleContextFixture: ChatbotContextRecord = {
  id: 'context-2',
  status: 'stale',
  requires_review: true,
  context_markdown: '# Acacia',
  source_ids: ['source-upload'],
  source_snapshot: {
    document_count: 1,
  },
  stale_at: '2026-08-04T17:00:00.000Z',
  version: 5,
}

export const contextRevisionFixture: ChatbotContextRevisionRecord = {
  id: 'revision-5',
  changed_source_ids: ['source-brand-book'],
  removed_source_ids: ['source-old'],
  model: 'deterministic-context-builder',
}
