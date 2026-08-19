import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('governed component registry migration', () => {
  it('stores immutable data-only descriptors with closed v2/v3 projections', async () => {
    const migration = await readFile(
      path.resolve(
        process.cwd(),
        '../../supabase/migrations/20260819005833_add_siteforge_governed_component_registry.sql'
      ),
      'utf8'
    )

    expect(migration).toContain('create table public.siteforge_component_registry')
    expect(migration).toContain('create table public.siteforge_component_versions')
    expect(migration).toContain(
      "package_manifest ->> 'format' = 'siteforge-governed-component-package-v1'"
    )
    expect(migration).toContain(
      "v2_catalog_entry ->> 'blockName' = 'acf/governed-component'"
    )
    expect(migration).toContain(
      "v3_catalog_entry ->> 'blockName' = 'acf/governed-component'"
    )
    expect(migration).toContain(
      'create trigger protect_siteforge_component_version_identity'
    )
    expect(migration).toContain(
      'revoke all on public.siteforge_component_versions from anon, authenticated'
    )
    expect(migration).not.toMatch(/\bapply_migration\b|\bexecute\b.*\bcode\b/i)
  })
})
