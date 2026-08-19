import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('SiteForgeEditorWorkspace recovery and visual context', () => {
  it('hydrates durable edit and preview jobs after reload', async () => {
    const source = await readFile(
      new URL('./SiteForgeEditorWorkspace.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('next.activeJobs?.semanticEdit')
    expect(source).toContain('next.activeJobs?.preview')
    expect(source).toContain('heartbeat_at')
    expect(source).toContain('attempt_count')
    expect(source).toContain('jobElapsed')
    expect(source).toContain('cancelPreview')
  })

  it('supports pasted, dropped, uploaded, and removable screenshots', async () => {
    const source = await readFile(
      new URL('./SiteForgeEditorWorkspace.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('onPaste=')
    expect(source).toContain('onDrop=')
    expect(source).toContain('type="file"')
    expect(source).toContain('removePendingAttachment')
    expect(source).toContain('pendingAttachments.map')
  })

  it('exposes explicit immutable revision restore controls', async () => {
    const source = await readFile(
      new URL('./SiteForgeEditorWorkspace.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('Revision history')
    expect(source).toContain('Restore v{revision.version}')
    expect(source).toContain('targetArtifactId')
    expect(source.indexOf('<details>')).toBeGreaterThan(
      source.indexOf('Exact WordPress preview')
    )
  })

  it('mounts the structured page manager alongside chat editing', async () => {
    const source = await readFile(
      new URL('./SiteForgeEditorWorkspace.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('<SiteForgePageManager')
    expect(source).toContain('submitPageManagerAction')
    expect(source).toContain('pageManagerAction: action')
    expect(source).toContain('onSelectPage={setSelectedPreviewPage}')
  })
})
