import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSiteForgeBuildMetadata,
  SITEFORGE_RUNTIME_ARTIFACT_FILENAMES,
  writeSiteForgeBuildMetadata,
} from './build-source-manifest'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('SiteForge build source metadata', () => {
  it('identifies clean and dirty source without requiring a new commit', async () => {
    const { repoRoot, runtimeAssetsDir } = await createFixtureRepository()

    const clean = await createSiteForgeBuildMetadata({
      repoRoot,
      runtimeAssetsDir,
    })
    expect(clean).toMatchObject({
      schemaVersion: 1,
      source: {
        dirty: false,
        gitSha: expect.stringMatching(/^[a-f0-9]{40}$/),
        dirtyDiffDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      acceptance: { cleanSourceRequired: true },
      runtimeArtifacts: SITEFORGE_RUNTIME_ARTIFACT_FILENAMES.map(filename => ({
        filename,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: expect.any(Number),
      })),
      metadataDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })

    await writeFile(path.join(repoRoot, 'tracked.txt'), 'changed source\n')
    await writeFile(path.join(repoRoot, 'untracked.txt'), 'local source\n')
    const firstDirty = await createSiteForgeBuildMetadata({
      repoRoot,
      runtimeAssetsDir,
    })
    const secondDirty = await createSiteForgeBuildMetadata({
      repoRoot,
      runtimeAssetsDir,
    })

    expect(firstDirty).toEqual(secondDirty)
    expect(firstDirty.source).toMatchObject({
      gitSha: clean.source.gitSha,
      dirty: true,
      untrackedFiles: [
        {
          path: 'untracked.txt',
          kind: 'file',
          sha256: sha256('local source\n'),
        },
      ],
    })
    expect(firstDirty.source.dirtyDiffDigest).not.toBe(
      clean.source.dirtyDiffDigest
    )
    expect(firstDirty.metadataDigest).not.toBe(clean.metadataDigest)

    await writeFile(path.join(repoRoot, 'untracked.txt'), 'different source\n')
    const changedDirty = await createSiteForgeBuildMetadata({
      repoRoot,
      runtimeAssetsDir,
    })
    expect(changedDirty.source.dirtyDiffDigest).not.toBe(
      firstDirty.source.dirtyDiffDigest
    )

    const outputPath = path.join(runtimeAssetsDir, 'build-metadata.json')
    const written = await writeSiteForgeBuildMetadata({
      outputPath,
      repoRoot,
      runtimeAssetsDir,
    })
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(written)
  })

  it('rejects runtime bytes that do not match their checked digest', async () => {
    const { repoRoot, runtimeAssetsDir } = await createFixtureRepository()
    await writeFile(
      path.join(runtimeAssetsDir, SITEFORGE_RUNTIME_ARTIFACT_FILENAMES[0]),
      'tampered'
    )

    await expect(
      createSiteForgeBuildMetadata({ repoRoot, runtimeAssetsDir })
    ).rejects.toThrow(/digest mismatch/)
  })
})

async function createFixtureRepository(): Promise<{
  repoRoot: string
  runtimeAssetsDir: string
}> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'siteforge-source-'))
  temporaryDirectories.push(repoRoot)
  const runtimeAssetsDir = path.join(repoRoot, 'runtime-assets')
  await mkdir(runtimeAssetsDir)
  await writeFile(path.join(repoRoot, '.gitignore'), 'runtime-assets/\n')
  await writeFile(path.join(repoRoot, 'tracked.txt'), 'committed source\n')
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot })
  execFileSync('git', ['add', '.'], { cwd: repoRoot })
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture baseline'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'SiteForge Test',
      GIT_AUTHOR_EMAIL: 'siteforge@example.test',
      GIT_COMMITTER_NAME: 'SiteForge Test',
      GIT_COMMITTER_EMAIL: 'siteforge@example.test',
    },
  })

  await Promise.all(
    SITEFORGE_RUNTIME_ARTIFACT_FILENAMES.map(async filename => {
      const bytes = Buffer.from(`PK deterministic ${filename}`)
      await Promise.all([
        writeFile(path.join(runtimeAssetsDir, filename), bytes),
        writeFile(
          path.join(runtimeAssetsDir, `${filename}.sha256`),
          `${sha256(bytes)}  ${filename}\n`
        ),
      ])
    })
  )
  return { repoRoot, runtimeAssetsDir }
}

function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(value).digest('hex')
}
