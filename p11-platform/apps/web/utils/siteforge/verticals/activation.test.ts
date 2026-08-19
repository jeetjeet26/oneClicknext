import { describe, expect, it } from 'vitest'
import type { Tables } from '@/types/supabase'
import { evaluateVerticalActivation } from './activation'
import { VERTICAL_REGISTRY_VERSION } from './registry'

const profileHash = 'a'.repeat(64)
const packHash = 'b'.repeat(64)
const context = {
  profile: { contentHash: profileHash },
  manifest: { contentHash: packHash },
} as Parameters<typeof evaluateVerticalActivation>[0]['context']

const activation: Tables<'siteforge_vertical_activation_versions'> = {
  id: '11111111-1111-4111-8111-111111111111',
  org_id: '22222222-2222-4222-8222-222222222222',
  property_id: '33333333-3333-4333-8333-333333333333',
  website_id: '44444444-4444-4444-8444-444444444444',
  version: 1,
  mode: 'canary',
  enabled: true,
  vertical_profile_content_hash: profileHash,
  vertical_pack_content_hash: packHash,
  registry_version: VERTICAL_REGISTRY_VERSION,
  qualification_report_hash: 'c'.repeat(64),
  reason: 'Qualified by the complete Vertical V2 matrix.',
  expires_at: null,
  approved_by: '55555555-5555-4555-8555-555555555555',
  approved_at: '2026-08-14T06:00:00.000Z',
  content_hash: 'd'.repeat(64),
  created_at: '2026-08-14T06:00:00.000Z',
}

describe('SiteForge Vertical V2 activation', () => {
  it('keeps off and shadow modes on the V1 write path', () => {
    expect(
      evaluateVerticalActivation({
        configuredMode: 'off',
        pinnedRegistryVersion: VERTICAL_REGISTRY_VERSION,
        context,
        activation,
      })
    ).toMatchObject({ useV2: false, runShadow: false, reason: 'mode_off' })
    expect(
      evaluateVerticalActivation({
        configuredMode: 'shadow',
        pinnedRegistryVersion: VERTICAL_REGISTRY_VERSION,
        context,
        activation,
      })
    ).toMatchObject({ useV2: false, runShadow: true, reason: 'shadow_only' })
  })

  it('activates V2 by default without requiring an allowlist row', () => {
    expect(
      evaluateVerticalActivation({
        configuredMode: 'on',
        pinnedRegistryVersion: VERTICAL_REGISTRY_VERSION,
        context,
        activation: null,
      })
    ).toMatchObject({
      useV2: true,
      effectiveMode: 'on',
      reason: 'activated',
      activationVersionId: null,
    })
  })

  it('carries activation ledger provenance through when a row exists', () => {
    expect(
      evaluateVerticalActivation({
        configuredMode: 'canary',
        pinnedRegistryVersion: VERTICAL_REGISTRY_VERSION,
        context,
        activation,
      })
    ).toMatchObject({
      useV2: true,
      effectiveMode: 'canary',
      reason: 'activated',
      activationVersionId: activation.id,
      qualificationReportHash: activation.qualification_report_hash,
    })
  })

  it('still fails closed on a registry version pin mismatch', () => {
    expect(
      evaluateVerticalActivation({
        configuredMode: 'on',
        pinnedRegistryVersion: 999,
        context,
        activation: null,
      })
    ).toMatchObject({ useV2: false, reason: 'registry_version_mismatch' })
  })
})
