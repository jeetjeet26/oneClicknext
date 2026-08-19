import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  assertSiteForgeEditorAgentOutcome,
  runtimeExtensionRequestSchema,
  validateSiteForgeEditorOperations,
} from './agent'
import type {
  BlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'

describe('SiteForge editor agent runtime extension contract', () => {
  it('uses the AI SDK v7 file-part multimodal message contract', async () => {
    const source = await readFile(new URL('./agent.ts', import.meta.url), 'utf8')
    expect(source).toContain("type: 'file' as const")
    expect(source).toContain('type ModelMessage')
    expect(source).toContain('data: bytes')
    expect(source).not.toContain("type: 'image'")
  })

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

  it('rejects block content that cannot pass final artifact validation', () => {
    const blueprint = {
      version: 1,
      updatedAt: new Date().toISOString(),
      pages: [
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Primary property landing page',
          sections: [],
        },
      ],
    } as SiteBlueprint
    const operations = [
      {
        version: 2,
        op: 'page.upsert',
        page: {
          slug: 'home',
          title: 'Home',
          purpose: 'Primary property landing page',
          seo: {
            title: 'Property Home',
            description:
              'Review approved property information and contact options for this apartment community.',
            canonicalPath: '/',
            noIndex: false,
            structuredData: ['WebPage'],
          },
          sections: [
            {
              id: 'hero',
              type: 'hero',
              acfBlock: 'acf/top-slides',
              order: 0,
              content: {},
              reasoning: 'Use a governed property hero',
            },
          ],
        },
      },
    ] as BlueprintPatchOperation[]

    expect(() =>
      validateSiteForgeEditorOperations({ blueprint, operations })
    ).toThrow(/slides/)
  })

  it('rejects factual copy with an untrusted evidence identity', () => {
    const blueprint = {
      version: 1,
      updatedAt: new Date().toISOString(),
      pages: [
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Primary property landing page',
          sections: [],
        },
      ],
    } as SiteBlueprint
    const operations = [
      {
        version: 2,
        op: 'page.upsert',
        page: {
          slug: 'home',
          title: 'Home',
          purpose: 'Primary property landing page',
          seo: {
            title: 'Property Home',
            description:
              'Review approved property information and contact options for this apartment community.',
            canonicalPath: '/',
            noIndex: false,
            structuredData: ['WebPage'],
          },
          sections: [
            {
              id: 'home-hero',
              type: 'hero',
              acfBlock: 'acf/text-section',
              order: 0,
              content: {
                headline: 'Unverified property claim',
                content: 'Unverified property claim',
                layout: 'center',
                background: 'white',
              },
              reasoning: 'Attempt to publish unsupported copy',
              evidenceIds: ['untrusted-evidence-id'],
            },
          ],
        },
      },
    ] as BlueprintPatchOperation[]

    expect(() =>
      validateSiteForgeEditorOperations({ blueprint, operations })
    ).toThrow(/does not retain an exact claim/)
    expect(() =>
      validateSiteForgeEditorOperations({
        blueprint,
        operations,
        verifiedEvidenceIds: ['untrusted-evidence-id'],
      })
    ).not.toThrow()
  })
})
