import { z } from 'zod'

export const SITEFORGE_CERTIFICATION_POLICY_VERSION =
  'siteforge-browser-certification-v3' as const
export const SITEFORGE_BROWSER_EVIDENCE_VERSION =
  'siteforge-browser-evidence-v1' as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const urlSchema = z.string().url()
const viewportSchema = z.enum(['desktop', 'tablet', 'mobile'])

const pageViewportSchema = z.object({
  url: urlSchema,
  viewport: viewportSchema,
})

export const browserCertificationEvidenceSchema = z.object({
  evidenceVersion: z.literal(SITEFORGE_BROWSER_EVIDENCE_VERSION),
  capturedAt: z.string().datetime(),
  screenshots: z.array(
    pageViewportSchema.extend({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      storagePath: z.string().min(1),
      sha256: sha256Schema,
    })
  ),
  baselineDiffs: z.array(
    pageViewportSchema.extend({
      baselineSha256: sha256Schema,
      actualSha256: sha256Schema,
      mismatchRatio: z.number().min(0).max(1),
      dimensionsMatch: z.boolean(),
      diffStoragePath: z.string().min(1),
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
        forms: z.array(
          z.object({
            id: z.string().min(1),
            submitted: z.boolean(),
            validationObserved: z.boolean(),
            destinationVerified: z.boolean(),
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
        formFactor: z.enum(['desktop', 'mobile']),
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
    scripts: z.array(
      z.object({
        src: z.string().min(1),
        category: z.enum(['essential', 'analytics', 'marketing', 'unknown']),
        loadedBeforeConsent: z.boolean(),
        loadedAfterConsent: z.boolean(),
      })
    ),
  }),
})

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
