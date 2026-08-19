import { describe, expect, it } from 'vitest'
import {
  SITEFORGE_EDITOR_ATTACHMENT_MAX_COUNT,
  siteForgeEditorAttachmentContextSchema,
  siteForgeEditorAttachmentIdsSchema,
  siteForgeEditorAttachmentSha256,
} from './attachments'

describe('SiteForge editor screenshot attachment contract', () => {
  it('binds screenshots to an exact artifact, page, and viewport', () => {
    expect(
      siteForgeEditorAttachmentContextSchema.parse({
        expectedArtifactId: '11111111-1111-4111-8111-111111111111',
        expectedContentHash: 'a'.repeat(64),
        pageSlug: 'availability',
        viewport: 'mobile',
      })
    ).toEqual(
      expect.objectContaining({
        pageSlug: 'availability',
        viewport: 'mobile',
      })
    )
  })

  it('rejects duplicate or excessive attachment identities', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(() => siteForgeEditorAttachmentIdsSchema.parse([id, id])).toThrow()
    expect(() =>
      siteForgeEditorAttachmentIdsSchema.parse(
        Array.from(
          { length: SITEFORGE_EDITOR_ATTACHMENT_MAX_COUNT + 1 },
          (_, index) =>
            `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
        )
      )
    ).toThrow()
  })

  it('hashes the exact private storage bytes', () => {
    expect(
      siteForgeEditorAttachmentSha256(
        new TextEncoder().encode('siteforge screenshot')
      )
    ).toBe('ec5d289764a1b441f96b4df2d06175e538360b1b3ca44ab043a36290fe06eb18')
  })
})
