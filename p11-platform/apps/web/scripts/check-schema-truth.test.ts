import { describe, expect, it } from 'vitest'
import {
  collectDeclaredStorageBuckets,
  collectSchemaReferences,
  getKnownSchemaObjects,
} from './check-schema-truth.mjs'

describe('schema-truth scanner', () => {
  it('parses tables, views, and RPCs from generated Supabase types', () => {
    const known = getKnownSchemaObjects(`
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: { Args: {}; Returns: unknown }
    }
    Enums: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      properties: {
        Row: {}
      }
    }
    Views: {
      property_summary: {
        Row: {}
      }
    }
    Functions: {
      match_documents: {
        Args: {}
      }
      score_lead: { Args: { p_lead_id: string }; Returns: string }
    }
    Enums: {
    }
  }
    `)

    expect([...known.tables]).toEqual(['properties', 'property_summary'])
    expect([...known.functions]).toEqual(['match_documents', 'score_lead'])
  })

  it('distinguishes table, storage, and RPC references', () => {
    const references = collectSchemaReferences(`
      const ARTIFACT_BUCKET = 'siteforge-artifacts'
      await client.from('properties').select('*')
      await client.storage.from(ARTIFACT_BUCKET).download('overlay.zip')
      await client.rpc('match_documents', {})
      Buffer.from('not-a-table')
      Array.from('not-a-table')
    `)

    expect(references).toEqual([
      { kind: 'table', name: 'properties' },
      { kind: 'storage', name: 'siteforge-artifacts' },
      { kind: 'function', name: 'match_documents' },
    ])
  })

  it('discovers storage buckets from migrations and explicit creation', () => {
    expect(
      collectDeclaredStorageBuckets([
        "insert into storage.buckets (id, name) values ('siteforge-artifacts', 'siteforge-artifacts');",
        "await supabase.storage.createBucket('brand-assets', { public: false })",
      ])
    ).toEqual(new Set(['siteforge-artifacts', 'brand-assets']))
  })
})
