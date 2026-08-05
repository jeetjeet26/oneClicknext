import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Tables } from '@/types/supabase'

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

const input = {
  sharedJobId: '11111111-1111-4111-8111-111111111111',
  websiteId: '22222222-2222-4222-8222-222222222222',
  propertyId: '33333333-3333-4333-8333-333333333333',
  orgId: '44444444-4444-4444-8444-444444444444',
  artifactId: '55555555-5555-4555-8555-555555555555',
  targetId: '66666666-6666-4666-8666-666666666666',
  contentHash: 'a'.repeat(64),
}

describe('canonical WordPress preview workflow steps', () => {
  beforeEach(() => {
    delete process.env.SITEFORGE_PREVIEW_WP_URL
    delete process.env.SITEFORGE_PREVIEW_WP_USERNAME
    delete process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD
  })

  afterEach(() => {
    delete process.env.SITEFORGE_PREVIEW_WP_URL
    delete process.env.SITEFORGE_PREVIEW_WP_USERNAME
    delete process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD
  })

  it('fails closed before database or network work without preview credentials', async () => {
    const { renderCanonicalWordPressPreview } = await import('./preview-steps')
    await expect(renderCanonicalWordPressPreview(input)).rejects.toThrow(
      /preview credentials are not configured/
    )
  })

  it('normalizes escaped newlines from provider credentials', async () => {
    const { normalizeSiteForgePreviewCredential } = await import(
      './preview-steps'
    )

    expect(
      normalizeSiteForgePreviewCredential(' https://wordpress.example.com\\n ')
    ).toBe('https://wordpress.example.com')
    expect(normalizeSiteForgePreviewCredential('')).toBeUndefined()
  })

  it('maps persisted asset columns into the WordPress client contract', async () => {
    const { mapWebsiteAssetRow } = await import(
      '@/utils/siteforge/assets/repository'
    )
    const mapped = mapWebsiteAssetRow({
      id: 'asset-1',
      website_id: input.websiteId,
      asset_type: 'hero_image',
      source: 'generated',
      file_url: 'https://hellop11.com/siteforge/property-placeholder.png',
      file_size_bytes: 1024,
      mime_type: 'image/png',
      wp_media_id: null,
      alt_text: 'Property photography coming soon',
      caption: null,
      optimized: false,
      original_url: null,
      created_at: '2026-07-30T22:00:00.000Z',
    } as unknown as Tables<'website_assets'>)

    expect(mapped).toEqual(
      expect.objectContaining({
        id: 'asset-1',
        websiteId: input.websiteId,
        fileUrl:
          'https://hellop11.com/siteforge/property-placeholder.png',
        mimeType: 'image/png',
      })
    )
  })

  it('links an exact render before certification is evaluated', async () => {
    const { buildRenderedPreviewCheckpoint } = await import('./preview-steps')
    expect(
      buildRenderedPreviewCheckpoint({
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        previewUrl: 'https://preview.example.com',
        renderedAt: '2026-08-03T17:30:00.000Z',
      })
    ).toEqual({
      canonical_preview_url: 'https://preview.example.com',
      canonical_preview_artifact_id: input.artifactId,
      canonical_preview_content_hash: input.contentHash,
      canonical_previewed_at: '2026-08-03T17:30:00.000Z',
      editor_lifecycle_status: 'preview_rendered',
      updated_at: '2026-08-03T17:30:00.000Z',
    })
  })

  it('preserves workflow-serialized failure messages for the dashboard', async () => {
    const { canonicalPreviewErrorMessage } = await import(
      '@/workflows/siteforge-canonical-preview'
    )

    expect(
      canonicalPreviewErrorMessage({
        message: 'WordPress theme overlay manifest hash does not match its files',
      })
    ).toBe('WordPress theme overlay manifest hash does not match its files')
  })

  it('keeps the rendered checkpoint aligned with the database lifecycle constraint', async () => {
    const migration = await readFile(
      path.resolve(
        process.cwd(),
        '../../supabase/migrations/20260803182116_allow_siteforge_preview_rendered_lifecycle.sql'
      ),
      'utf8'
    )

    expect(migration).toContain("'preview_rendered'")
  })
})
