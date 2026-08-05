import { describe, expect, it } from 'vitest'
import {
  assertSiteForgeEditorAgentOutcome,
  runtimeExtensionRequestSchema,
} from './agent'
import type { BlueprintPatchOperation } from '@/types/siteforge'

describe('SiteForge editor agent runtime extension contract', () => {
  it('accepts exactly one bounded allowlisted overlay proposal', () => {
    const request = runtimeExtensionRequestSchema.parse({
      capability: 'interactive hero treatment',
      reason: 'Semantic operations cannot express the interaction',
      requestedBehavior: 'Animate the approved hero after initial render',
      overlay: {
        reason: 'Add the reviewed interaction',
        files: [
          {
            path: 'assets/js/hero-ready.js',
            content:
              'document.querySelector(".hero")?.classList.add("is-ready")',
          },
        ],
      },
    })
    expect(request.overlay.files).toHaveLength(1)
    expect(() =>
      assertSiteForgeEditorAgentOutcome({
        operations: [],
        extensionRequest: request,
        clarification: null,
      })
    ).not.toThrow()
  })

  it.each([
    '../wp-config.php',
    '/tmp/payload.js',
    'assets/images/payload.svg',
    'partials/../../payload.php',
  ])('rejects malicious overlay path %s', path => {
    expect(() =>
      runtimeExtensionRequestSchema.parse({
        capability: 'unsafe',
        reason: 'unsafe',
        requestedBehavior: 'unsafe',
        overlay: {
          reason: 'unsafe',
          files: [{ path, content: 'payload' }],
        },
      })
    ).toThrow()
  })

  it('rejects mixed semantic, clarification, and extension outcomes', () => {
    const operation = {
      op: 'replace',
      path: '/pages/0/title',
      value: 'Updated',
    } as unknown as BlueprintPatchOperation
    expect(() =>
      assertSiteForgeEditorAgentOutcome({
        operations: [operation],
        extensionRequest: {
          capability: 'mixed',
          reason: 'mixed',
          requestedBehavior: 'mixed',
          overlay: {
            reason: 'mixed',
            files: [
              {
                path: 'assets/css/mixed.css',
                content: '.mixed { display: block; }',
              },
            ],
          },
        },
        clarification: null,
      })
    ).toThrow(/exactly one/)
    expect(() =>
      assertSiteForgeEditorAgentOutcome({
        operations: [],
        extensionRequest: null,
        clarification: null,
      })
    ).toThrow(/exactly one/)
  })
})
