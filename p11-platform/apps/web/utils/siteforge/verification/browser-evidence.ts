import { z } from 'zod'
import { certificationArtifactBindingSchema } from './certification-binding'

export const SITEFORGE_CERTIFICATION_POLICY_VERSION =
  'siteforge-browser-certification-v16' as const
export const SITEFORGE_BROWSER_EVIDENCE_VERSION =
  'siteforge-browser-evidence-v2' as const
export const SITEFORGE_LEGACY_BROWSER_EVIDENCE_VERSION =
  'siteforge-browser-evidence-v1' as const
export const SITEFORGE_MAX_VISUAL_MISMATCH_RATIO = 0.0002 as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const urlSchema = z.string().url()
const viewportSchema = z.enum(['desktop', 'tablet', 'mobile'])
export const browserCertificationEnvironmentSchema = z.enum([
  'protected_preview',
  'staging',
  'production',
])
export const browserCertificationAccessSchema = z.enum(['protected', 'public'])

const durableStoragePathSchema = z
  .string()
  .min(1)
  .refine(
    value => !value.startsWith('browserbase://'),
    'Browserbase session URLs are not durable artifact storage paths'
  )

const pageViewportSchema = z.object({
  url: urlSchema,
  viewport: viewportSchema,
})

const artifactIdentitySchema = z.object({
  artifactId: z.string().uuid(),
  contentHash: sha256Schema,
})

export const lighthouseArtifactSchema = z.object({
  url: urlSchema,
  formFactor: z.enum(['desktop', 'mobile']),
  storagePath: durableStoragePathSchema,
  sha256: sha256Schema,
  provider: z.string().min(1),
  providerRunId: z.string().min(1),
  runnerBinarySha256: sha256Schema,
  runnerConfigSha256: sha256Schema,
  toolManifestSha256: sha256Schema,
  environment: browserCertificationEnvironmentSchema,
  access: browserCertificationAccessSchema,
  bindingHash: sha256Schema,
  generatedAt: z.string().datetime(),
})

export const approvedVisualBaselineSchema = pageViewportSchema.extend({
  baselineId: z.string().uuid(),
  storagePath: durableStoragePathSchema,
  sha256: sha256Schema,
  artifact: artifactIdentitySchema,
  environment: browserCertificationEnvironmentSchema,
  access: browserCertificationAccessSchema,
  requireIndexable: z.boolean(),
  policyVersion: z.literal(SITEFORGE_CERTIFICATION_POLICY_VERSION),
  bindingHash: sha256Schema,
  evidenceDigest: sha256Schema,
  approvalId: z.string().uuid(),
  approvedAt: z.string().datetime(),
  approvedBy: z.string().uuid(),
})

export const browserCertificationEvidenceSchema = z.object({
  evidenceVersion: z.literal(SITEFORGE_BROWSER_EVIDENCE_VERSION),
  capturedAt: z.string().datetime(),
  identity: z.object({
    sessionId: z.string().min(1),
    targetUrl: urlSchema,
    environment: browserCertificationEnvironmentSchema,
    access: browserCertificationAccessSchema,
    requireIndexable: z.boolean(),
    artifact: artifactIdentitySchema,
    artifactBinding: certificationArtifactBindingSchema,
    bindingHash: sha256Schema,
  }),
  screenshots: z.array(
    pageViewportSchema.extend({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      storagePath: durableStoragePathSchema,
      sha256: sha256Schema,
      bytes: z.number().int().positive(),
      contentType: z.literal('image/png'),
      identityDigest: sha256Schema,
    })
  ),
  baselineDiffs: z.array(
    pageViewportSchema.extend({
      baselineStoragePath: durableStoragePathSchema,
      baselineId: z.string().uuid(),
      baselineSha256: sha256Schema,
      baselineBindingHash: sha256Schema,
      baselineEvidenceDigest: sha256Schema,
      baselineApprovalId: z.string().uuid(),
      baselineApprovedAt: z.string().datetime(),
      baselineApprovedBy: z.string().uuid(),
      actualStoragePath: durableStoragePathSchema,
      actualSha256: sha256Schema,
      comparisonMethod: z.literal('pixelmatch-v2'),
      mismatchRatio: z.number().min(0).max(1),
      mismatchThreshold: z.literal(SITEFORGE_MAX_VISUAL_MISMATCH_RATIO),
      mismatchedPixels: z.number().int().min(0),
      totalPixels: z.number().int().positive(),
      dimensionsMatch: z.boolean(),
    })
  ),
  layout: z.array(
    pageViewportSchema.extend({
      horizontalOverflowPixels: z.number().min(0),
      cumulativeLayoutShift: z.number().min(0),
    })
  ),
  interactions: z.object({
    pages: z.array(
      z.object({
        url: urlSchema,
        linksTested: z.number().int().min(0),
        buttonsTested: z.number().int().min(0),
        navigation: z.array(
          z.object({
            requestedUrl: urlSchema,
            finalUrl: urlSchema,
            status: z.number().int(),
            passed: z.boolean(),
          })
        ),
        network: z.array(
          z.object({
            url: urlSchema,
            method: z.string().min(1),
            resourceType: z.string().min(1),
            status: z.number().int().optional(),
            aborted: z.boolean(),
          })
        ),
        forms: z.array(
          z.object({
            id: z.string().min(1),
            attempted: z.boolean(),
            validationObserved: z.boolean(),
            destinationVerified: z.boolean(),
            payloadVerified: z.boolean(),
            sideEffectPrevented: z.boolean(),
            request: z
              .object({
                url: urlSchema,
                method: z.string().min(1),
                payload: z.record(z.string(), z.unknown()),
                aborted: z.boolean(),
              })
              .optional(),
            resultingState: z.enum(['validation', 'error', 'success', 'none']),
          })
        ),
        widgets: z.array(
          z.object({
            id: z.string().min(1),
            opened: z.boolean(),
            usable: z.boolean(),
          })
        ),
        keyboard: z.object({
          traversed: z.boolean(),
          traps: z.array(z.string()),
          unreachableControls: z.array(z.string()),
        }),
        focus: z.object({
          visible: z.boolean(),
          orderValid: z.boolean(),
          obscuredControls: z.array(z.string()),
        }),
      })
    ),
  }),
  accessibility: z.object({
    scans: z.array(
      z.object({
        url: urlSchema,
        engine: z.literal('axe-core'),
        engineVersion: z.string().min(1),
        findings: z.array(
          z.object({
            ruleId: z.string().min(1),
            impact: z.enum(['minor', 'moderate', 'serious', 'critical']),
            description: z.string().min(1),
            helpUrl: urlSchema.optional(),
            nodes: z.array(
              z.object({
                target: z.array(z.string()).min(1),
                html: z.string(),
                failureSummary: z.string().optional(),
              })
            ),
          })
        ),
      })
    ),
  }),
  lighthouse: z.object({
    runs: z.array(
      z.object({
        url: urlSchema,
        finalUrl: urlSchema,
        formFactor: z.enum(['desktop', 'mobile']),
        source: z.literal('lighthouse'),
        lighthouseVersion: z.string().min(1),
        generatedAt: z.string().datetime(),
        reportStoragePath: durableStoragePathSchema,
        reportSha256: sha256Schema,
        provider: z.string().min(1),
        providerRunId: z.string().min(1),
        runnerBinarySha256: sha256Schema,
        runnerConfigSha256: sha256Schema,
        toolManifestSha256: sha256Schema,
        bindingHash: sha256Schema,
        performance: z.number().min(0).max(1),
        accessibility: z.number().min(0).max(1),
        bestPractices: z.number().min(0).max(1),
        seo: z.number().min(0).max(1),
        largestContentfulPaintMs: z.number().min(0),
        cumulativeLayoutShift: z.number().min(0),
        totalBlockingTimeMs: z.number().min(0),
      })
    ),
  }),
  seo: z.object({
    pages: z.array(
      z.object({
        url: urlSchema,
        canonicalUrl: urlSchema.optional(),
        openGraph: z.object({
          title: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          imageUrl: urlSchema.optional(),
          url: urlSchema.optional(),
        }),
        jsonLd: z.array(
          z.object({
            valid: z.boolean(),
            types: z.array(z.string()),
            errors: z.array(z.string()),
          })
        ),
      })
    ),
    sitemap: z.object({
      url: urlSchema,
      status: z.number().int(),
      listedUrls: z.array(urlSchema),
    }),
    robots: z.object({
      url: urlSchema,
      status: z.number().int(),
      sitemapUrls: z.array(urlSchema),
      blockedCriticalUrls: z.array(urlSchema),
    }),
  }),
  redirects: z.object({
    entries: z.array(
      z.object({
        from: urlSchema,
        to: urlSchema,
        status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
      })
    ),
    criticalRoutes: z.array(
      z.object({
        requestedUrl: urlSchema,
        finalUrl: urlSchema,
        status: z.number().int(),
        hops: z.number().int().min(0),
      })
    ),
  }),
  consent: z.object({
    defaultState: z.enum(['denied', 'granted']),
    bannerVisible: z.boolean(),
    preferenceControlsUsable: z.boolean(),
    declineTested: z.boolean(),
    grantTested: z.boolean(),
    scripts: z.array(
      z.object({
        src: z.string().min(1),
        category: z.enum(['essential', 'analytics', 'marketing', 'unknown']),
        loadedBeforeConsent: z.boolean(),
        loadedAfterConsent: z.boolean(),
      })
    ),
  }),
}).superRefine((evidence, context) => {
  if (
    evidence.identity.artifact.artifactId !==
      evidence.identity.artifactBinding.artifactId ||
    evidence.identity.artifact.contentHash !==
      evidence.identity.artifactBinding.contentHash
  ) {
    context.addIssue({
      code: 'custom',
      path: ['identity', 'artifactBinding'],
      message: 'Artifact and release binding identities must match',
    })
  }
  const screenshots = new Map(
    evidence.screenshots.map(item => [
      `${item.url}|${item.viewport}`,
      item,
    ])
  )
  for (const diff of evidence.baselineDiffs) {
    const actual = screenshots.get(`${diff.url}|${diff.viewport}`)
    if (!actual) continue
    if (
      diff.actualStoragePath === diff.baselineStoragePath ||
      actual.storagePath === diff.baselineStoragePath
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineDiffs'],
        message: 'A current screenshot cannot be used as its own approved baseline',
      })
    }
    if (
      actual.storagePath !== diff.actualStoragePath ||
      actual.sha256 !== diff.actualSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineDiffs'],
        message: 'Visual diff actual identity does not match the captured screenshot',
      })
    }
    if (new Date(diff.baselineApprovedAt) >= new Date(evidence.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['baselineDiffs'],
        message: 'A visual baseline must be approved before current evidence capture',
      })
    }
    if (
      diff.baselineBindingHash !== evidence.identity.bindingHash ||
      diff.baselineStoragePath === diff.actualStoragePath
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineDiffs'],
        message: 'Visual baseline must use the exact approved binding identity',
      })
    }
    const expectedRatio = diff.mismatchedPixels / diff.totalPixels
    if (Math.abs(diff.mismatchRatio - expectedRatio) > Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        path: ['baselineDiffs'],
        message: 'Pixel comparison ratio is inconsistent with its evidence counts',
      })
    }
  }
})

// Read-only callers may still recognize archived v1 payloads. Certification uses
// browserCertificationEvidenceSchema directly and therefore never accepts them.
export const legacyBrowserCertificationEvidenceSchema = z
  .object({
    evidenceVersion: z.literal(SITEFORGE_LEGACY_BROWSER_EVIDENCE_VERSION),
    capturedAt: z.string().datetime(),
  })
  .passthrough()

export const browserCertificationEvidenceReaderSchema = z.union([
  browserCertificationEvidenceSchema,
  legacyBrowserCertificationEvidenceSchema,
])

export type BrowserCertificationEvidence = z.infer<
  typeof browserCertificationEvidenceSchema
>

export const browserCertificationCheckSchema = z.object({
  code: z.string().min(1),
  category: z.enum([
    'visual',
    'layout',
    'interaction',
    'accessibility',
    'performance',
    'seo',
    'redirects',
    'consent',
    'evidence',
  ]),
  passed: z.boolean(),
  severity: z.enum(['blocker', 'warning']),
  waiverClass: z.enum(['waivable', 'identity', 'legal', 'rights', 'critical_accessibility']),
  message: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()),
})

export const browserCertificationReportSchema = z.object({
  policyVersion: z.literal(SITEFORGE_CERTIFICATION_POLICY_VERSION),
  evidenceVersion: z.literal(SITEFORGE_BROWSER_EVIDENCE_VERSION),
  evaluatedAt: z.string().datetime(),
  passed: z.boolean(),
  evidenceAccepted: z.boolean(),
  checks: z.array(browserCertificationCheckSchema),
})

export type BrowserCertificationCheck = z.infer<
  typeof browserCertificationCheckSchema
>
export type BrowserCertificationReport = z.infer<
  typeof browserCertificationReportSchema
>
