import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SiteForge list entry flow', () => {
  it('starts the guided journey directly without mounting the legacy wizard', () => {
    const source = readFileSync(
      new URL('./page.tsx', import.meta.url),
      'utf8'
    )

    expect(source).not.toContain('ConversationalGenerationWizard')
    expect(source).not.toContain('showGenerationWizard')
    expect(source).toContain("mode: 'new'")
    expect(source).toContain(
      'router.push(`/dashboard/siteforge/${body.project.websiteId}`)'
    )
    expect(source).toContain('Start New Website')
    expect(source).toMatch(/>\s*Resume\s*</)
  })
})
