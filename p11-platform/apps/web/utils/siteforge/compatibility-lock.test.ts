import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITEFORGE_COMPATIBILITY_LOCK_V1 as compatibilityLock } from '@/fixtures/siteforge-compatibility-lock.v1'

const repoRoot = path.resolve(process.cwd(), '../../..')

describe('SiteForge frozen compatibility surfaces', () => {
  it.each(Object.entries(compatibilityLock.files))(
    'detects mutation of %s',
    async (relativePath, expectedDigest) => {
      const bytes = await readFile(path.join(repoRoot, relativePath))
      expect(sha256(bytes)).toBe(expectedDigest)
    }
  )

  it.each(Object.entries(compatibilityLock.groups))(
    'pins the aggregate %s compatibility digest',
    async (_name, group) => {
      const entries = await Promise.all(
        group.files.map(async relativePath => ({
          path: relativePath,
          sha256: sha256(await readFile(path.join(repoRoot, relativePath))),
        }))
      )

      expect(group.files).toEqual([...group.files].sort())
      expect(sha256(JSON.stringify(entries))).toBe(group.digest)
    }
  )
})

function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(value).digest('hex')
}
