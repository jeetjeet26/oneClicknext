import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  publishSiteForgeArtifact,
  SITEFORGE_GENERATION_CHANGE_TYPE,
} from './repository'

describe('SiteForge artifact repository contracts', () => {
  it('uses the live-schema change type for generated artifacts', () => {
    expect(SITEFORGE_GENERATION_CHANGE_TYPE).toBe('generation')
  })

  it('pins generation to the published immutable base-theme package', async () => {
    const assets: Record<string, unknown> = {}
    assets.select = () => assets
    assets.eq = () => assets
    assets.order = () => Promise.resolve({ data: [], error: null })

    const packages: Record<string, unknown> = {}
    packages.select = () => packages
    packages.eq = () => packages
    packages.is = () => packages
    packages.order = () => packages
    packages.limit = () => packages
    packages.maybeSingle = () =>
      Promise.resolve({
        data: {
          package_sha256: 'a'.repeat(64),
          storage_path: `runtime-packages/base_theme/${'a'.repeat(64)}/oneclick-siteforge.zip`,
          manifest: { filename: 'oneclick-siteforge.zip', bytes: 86708 },
        },
        error: null,
      })
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: '77777777-7777-4777-8777-777777777777',
        version: 1,
        content_hash: 'b'.repeat(64),
      },
      error: null,
    })
    const client = {
      from: (table: string) =>
        table === 'website_assets' ? assets : packages,
      rpc,
    }

    await expect(
      publishSiteForgeArtifact(
        {
          websiteId: '22222222-2222-4222-8222-222222222222',
          propertyId: '33333333-3333-4333-8333-333333333333',
          orgId: '44444444-4444-4444-8444-444444444444',
          sharedJobId: '55555555-5555-4555-8555-555555555555',
          sourcePlanVersionId: '66666666-6666-4666-8666-666666666666',
          blueprint: {
            wordpressThemeArtifact: {
              theme: { version: '2.2.11' },
            },
            pages: [],
          },
          qualityReport: {},
          qualityScore: 100,
        },
        client as never
      )
    ).resolves.toMatchObject({ version: 1 })
    expect(rpc).toHaveBeenCalledWith(
      'publish_siteforge_artifact_revision',
      expect.objectContaining({
        p_base_theme_package_id: 'oneclick-siteforge@2.2.11',
        p_base_theme_package_sha256: 'a'.repeat(64),
      })
    )
  })

  it('refuses to snapshot assets without approval and cleared rights', async () => {
    const query: Record<string, unknown> = {}
    query.select = () => query
    query.eq = () => query
    query.order = () =>
      Promise.resolve({
        data: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            asset_type: 'hero_image',
            source: 'generated',
            file_url: 'https://example.com/hero.jpg',
            storage_path: 'assets/hero.jpg',
            byte_sha256: 'a'.repeat(64),
            content_hash: 'a'.repeat(64),
            approval_status: 'pending',
            rights_status: 'generated',
          },
        ],
        error: null,
      })
    const client = { from: () => query }

    await expect(
      publishSiteForgeArtifact(
        {
          websiteId: '22222222-2222-4222-8222-222222222222',
          propertyId: '33333333-3333-4333-8333-333333333333',
          orgId: '44444444-4444-4444-8444-444444444444',
          sharedJobId: '55555555-5555-4555-8555-555555555555',
          sourcePlanVersionId: '66666666-6666-4666-8666-666666666666',
          blueprint: {
            pages: [
              {
                sections: [
                  { imageUrl: 'https://example.com/hero.jpg' },
                ],
              },
            ],
          },
          qualityReport: {},
          qualityScore: 100,
        },
        client as never
      )
    ).rejects.toThrow('not approved and rights-cleared')
  })

  it('keeps atomic publication, target preview leasing, and rollback package identity in the migration contract', async () => {
    const migration = await readFile(
      path.resolve(
        process.cwd(),
        '../../supabase/migrations/20260731154500_harden_siteforge_control_plane.sql'
      ),
      'utf8'
    )
    const runtimeMigration = await readFile(
      path.resolve(
        process.cwd(),
        '../../supabase/migrations/20260803184237_siteforge_runtime_v2_contract.sql'
      ),
      'utf8'
    )

    expect(runtimeMigration).toContain(
      'shared_jobs_siteforge_preview_target_lease_idx'
    )
    expect(migration).toContain(
      "where shared_job_id = v_shared_job_id"
    )
    expect(migration).toContain(
      "set current_artifact_version_id = v_created.id"
    )
    expect(migration).toContain(
      "if p_change_type = 'rollback'"
    )
    expect(migration).toContain(
      'v_release_source.asset_manifest_hash'
    )
  })
})
