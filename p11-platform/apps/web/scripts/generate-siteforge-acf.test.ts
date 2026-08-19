import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateSiteForgeAcf,
  renderSiteForgeAcfGroups,
} from './generate-siteforge-acf.mjs'

describe('SiteForge ACF schema generation', () => {
  it('generates the complete deterministic schema set and passes drift check', async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), 'siteforge-acf-')
    )
    try {
      const first = await generateSiteForgeAcf({ outputDirectory })
      const expected = renderSiteForgeAcfGroups()
      expect(first.count).toBe(22)
      expect(await readdir(outputDirectory)).toEqual(
        expect.arrayContaining(Object.keys(expected))
      )
      for (const [filename, content] of Object.entries(expected)) {
        expect(await readFile(path.join(outputDirectory, filename), 'utf8')).toBe(
          content
        )
      }
      await expect(
        generateSiteForgeAcf({ outputDirectory, check: true })
      ).resolves.toEqual(first)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('reports modified, missing, and stale generated schemas without rewriting them', async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), 'siteforge-acf-drift-')
    )
    try {
      await generateSiteForgeAcf({ outputDirectory })
      const modified = 'group_siteforge_menu.json'
      const missing = 'group_siteforge_map.json'
      const stale = 'group_siteforge_stale.json'
      await writeFile(path.join(outputDirectory, modified), '{}\n')
      await rm(path.join(outputDirectory, missing))
      await writeFile(path.join(outputDirectory, stale), '{}\n')

      await expect(
        generateSiteForgeAcf({ outputDirectory, check: true })
      ).rejects.toThrow(
        /group_siteforge_map\.json is missing[\s\S]*group_siteforge_menu\.json differs[\s\S]*group_siteforge_stale\.json is stale/
      )
      expect(await readFile(path.join(outputDirectory, modified), 'utf8')).toBe(
        '{}\n'
      )
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
})
