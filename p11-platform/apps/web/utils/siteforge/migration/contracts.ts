import { z } from 'zod'

const absoluteHttpUrlSchema = z
  .url()
  .max(2_048)
  .refine(value => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Expected an HTTP(S) URL',
  })

const jsonObjectSchema = z.record(z.string(), z.unknown())
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const crawlerManifestProvenanceSchema = z
  .object({
    producer: z.literal('p11-data-engine/siteaudit'),
    schemaVersion: z.literal('siteforge-migration-manifest-v2'),
    crawlId: z.string().trim().min(1).max(200),
    generatedAt: z.iso.datetime(),
    checkedUrlCount: z.number().int().positive(),
    manifestHash: sha256Schema,
    signature: sha256Schema,
  })
  .strict()

export const migrationPageSchema = z
  .object({
    url: absoluteHttpUrlSchema,
    finalUrl: absoluteHttpUrlSchema.nullish(),
    statusCode: z.number().int().min(100).max(599).nullable(),
    canonicalUrl: absoluteHttpUrlSchema.nullish(),
    pageType: z.string().trim().min(1).max(100),
    inSitemap: z.boolean(),
  })
  .strict()

export const proposedIAEntrySchema = z
  .object({
    sourceUrl: absoluteHttpUrlSchema,
    targetUrl: absoluteHttpUrlSchema,
    pageType: z.string().trim().min(1).max(100),
    title: z.string().max(1_000).nullable(),
    parentPath: z.string().trim().startsWith('/').max(2_048),
  })
  .strict()

export const sourceInventorySchema = z
  .object({
    origin: absoluteHttpUrlSchema,
    pages: z.array(migrationPageSchema).max(10_000),
    sitemapUrls: z.array(absoluteHttpUrlSchema).max(20_000),
    proposedIA: z.array(proposedIAEntrySchema).max(10_000),
    readOnlyProof: z
      .object({
        sourceOrigin: absoluteHttpUrlSchema,
        targetOrigin: absoluteHttpUrlSchema,
        sourceRole: z.literal('read_only'),
        targetRole: z.literal('write_target'),
        allowedSourceMethods: z
          .array(z.enum(['GET', 'HEAD', 'OPTIONS']))
          .min(1)
          .max(3),
        sourceMutationAllowed: z.literal(false),
      })
      .strict(),
  })
  .strict()

export const contentManifestSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            url: absoluteHttpUrlSchema,
            canonicalUrl: absoluteHttpUrlSchema.nullish(),
            targetUrl: absoluteHttpUrlSchema,
            metadata: jsonObjectSchema,
            schema: jsonObjectSchema,
            content: jsonObjectSchema,
            provenance: jsonObjectSchema.and(
              z
                .object({
                  captureMode: z.literal('read_only'),
                  sourceUrl: absoluteHttpUrlSchema,
                  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
                })
                .passthrough()
            ),
          })
          .strict()
      )
      .max(10_000),
  })
  .strict()

export const migrationAssetSchema = jsonObjectSchema.and(
  z
    .object({
      sourceUrl: absoluteHttpUrlSchema,
      discoveredOn: z.array(absoluteHttpUrlSchema).min(1),
      provenance: z
        .object({
          sourcePage: absoluteHttpUrlSchema,
          captureMode: z.literal('read_only'),
        })
        .strict(),
    })
    .passthrough()
)

export const migrationFormSchema = jsonObjectSchema.and(
  z
    .object({
      sourcePage: absoluteHttpUrlSchema,
      action: absoluteHttpUrlSchema,
      method: z.string().trim().toLowerCase().max(20),
      fields: z.array(jsonObjectSchema).max(100),
      provenance: z
        .object({
          captureMode: z.literal('read_only'),
          valuesCaptured: z.literal(false),
        })
        .strict(),
    })
    .passthrough()
)

export const redirectEntrySchema = z
  .object({
    from: absoluteHttpUrlSchema,
    to: absoluteHttpUrlSchema,
    status: z.literal('301'),
  })
  .strict()

export const redirectMapSchema = z
  .array(redirectEntrySchema)
  .max(20_000)
  .superRefine((entries, context) => {
    const targets = new Map<string, string>()
    entries.forEach((entry, index) => {
      const current = targets.get(entry.from)
      if (entry.from === entry.to) {
        context.addIssue({
          code: 'custom',
          path: [index, 'to'],
          message: 'Redirect loops are prohibited',
        })
      } else if (current && current !== entry.to) {
        context.addIssue({
          code: 'custom',
          path: [index, 'from'],
          message: 'A source URL cannot have conflicting targets',
        })
      }
      targets.set(entry.from, entry.to)
    })

    entries.forEach((entry, index) => {
      const seen = new Set([entry.from])
      let cursor = entry.to
      while (targets.has(cursor)) {
        if (seen.has(cursor)) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message: 'Redirect loops are prohibited',
          })
          break
        }
        seen.add(cursor)
        cursor = targets.get(cursor)!
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'Redirect chains are prohibited; point directly to the final URL',
        })
        break
      }
    })
  })

export const redirectDecisionSchema = z
  .object({
    sourceUrl: absoluteHttpUrlSchema,
    decision: z.enum(['redirect', 'preserve', 'exclude']),
    targetUrl: absoluteHttpUrlSchema.nullable(),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === 'redirect' && !value.targetUrl) {
      context.addIssue({
        code: 'custom',
        path: ['targetUrl'],
        message: 'Redirect decisions require a target URL',
      })
    }
    if (value.decision !== 'redirect' && value.targetUrl) {
      context.addIssue({
        code: 'custom',
        path: ['targetUrl'],
        message: 'Only redirect decisions may declare a target URL',
      })
    }
  })

export const dnsReadOnlySnapshotSchema = z
  .object({
    captureMode: z.literal('read_only'),
    status: z.enum(['not_captured', 'captured', 'failed']),
    capturedAt: z.iso.datetime().optional(),
    records: z
      .array(
        z
          .object({
            type: z.string().trim().min(1).max(20),
            name: z.string().trim().min(1).max(255),
            value: z.string().trim().min(1).max(2_048),
            ttl: z.number().int().positive().optional(),
          })
          .strict()
      )
      .max(1_000),
    error: z.string().trim().max(2_000).optional(),
  })
  .strict()

const sideBySideEvidenceSchema = z
  .object({
    source: z
      .object({
        url: absoluteHttpUrlSchema,
        contentHash: sha256Schema,
        metadataHash: sha256Schema,
        assetCount: z.number().int().nonnegative(),
        formCount: z.number().int().nonnegative(),
      })
      .strict(),
    target: z
      .object({
        url: absoluteHttpUrlSchema,
        contentHash: sha256Schema,
        metadataHash: sha256Schema,
        assetCount: z.number().int().nonnegative(),
        formCount: z.number().int().nonnegative(),
      })
      .strict(),
    checks: z
      .object({
        content: z.boolean(),
        metadata: z.boolean(),
        assets: z.boolean(),
        forms: z.boolean(),
      })
      .strict(),
    status: z.enum(['matched', 'mismatch']),
  })
  .strict()

export const parityReportSchema = z
  .object({
    status: z.enum(['pending', 'complete', 'failed']),
    algorithm: z.literal('siteforge-parity-v1'),
    checkedUrls: z.number().int().nonnegative(),
    sideBySide: z.array(sideBySideEvidenceSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === 'complete' &&
      (value.checkedUrls <= 0 ||
        value.checkedUrls !== value.sideBySide.length ||
        value.sideBySide.some(
          item =>
            item.status !== 'matched' ||
            Object.values(item.checks).some(check => !check)
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message:
          'Complete parity requires positive, deterministic checks for every compared URL',
      })
    }
  })

export const unmigratedItemSchema = z
  .object({
    url: absoluteHttpUrlSchema,
    reason: z.string().trim().min(1).max(2_000),
    status: z.enum(['requires_operator_review', 'accepted_exception', 'resolved']),
  })
  .strict()

const postLaunchPendingSchema = z
  .object({
    status: z.literal('pending'),
    requiredChecks: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  })
  .strict()

const postLaunchCompletedSchema = z
  .object({
    status: z.enum(['passed', 'failed']),
    requiredChecks: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
    verifiedAt: z.iso.datetime(),
    checkedUrls: z.number().int().positive(),
    failures: z
      .array(
        z
          .object({
            url: absoluteHttpUrlSchema,
            statusCode: z.number().int().min(100).max(599),
            passed: z.boolean(),
            checks: z.record(z.string(), z.boolean()),
          })
          .passthrough()
      )
      .max(10_000),
    evidence: z
      .array(
        z
          .object({
            url: absoluteHttpUrlSchema,
            statusCode: z.number().int().min(100).max(599),
            passed: z.boolean(),
            checks: z.record(z.string(), z.boolean()),
          })
          .passthrough()
      )
      .min(1)
      .max(10_000),
    evidenceHash: sha256Schema,
    manifestHash: sha256Schema,
    provenance: z
      .object({
        producer: z.literal('p11-data-engine/siteaudit'),
        schemaVersion: z.literal('siteforge-post-launch-crawl-v1'),
        crawlId: z.string().trim().min(1).max(200),
        signature: sha256Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'passed' && value.failures.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['failures'],
        message: 'A passed post-launch crawl cannot contain failures',
      })
    }
    value.evidence.forEach((item, index) => {
      if (
        value.requiredChecks.some(check => typeof item.checks[check] !== 'boolean')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', index, 'checks'],
          message: 'Every checked URL must report every required deterministic check',
        })
      }
    })
  })

export const postLaunchCrawlSchema = z.discriminatedUnion('status', [
  postLaunchPendingSchema,
  postLaunchCompletedSchema,
])

export const siteForgeMigrationManifestInputSchema = z
  .object({
    propertyId: z.guid(),
    crawlerProvenance: crawlerManifestProvenanceSchema,
    sourceUrl: absoluteHttpUrlSchema,
    sourceReadOnly: z.literal(true),
    sourceInventory: sourceInventorySchema,
    contentManifest: contentManifestSchema,
    assetManifest: z.array(migrationAssetSchema).max(20_000),
    formManifest: z.array(migrationFormSchema).max(10_000),
    redirectMap: redirectMapSchema,
    redirectDecisions: z.array(redirectDecisionSchema).min(1).max(20_000),
    unmigratedItems: z.array(unmigratedItemSchema).max(10_000),
    dnsSnapshot: dnsReadOnlySnapshotSchema,
    parityReport: parityReportSchema,
    postLaunchCrawl: postLaunchCrawlSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const sourceOrigin = new URL(value.sourceUrl).origin
    const proof = value.sourceInventory.readOnlyProof
    if (new URL(proof.sourceOrigin).origin !== sourceOrigin) {
      context.addIssue({
        code: 'custom',
        path: ['sourceInventory', 'readOnlyProof', 'sourceOrigin'],
        message: 'Read-only proof must match the source origin',
      })
    }
    if (new URL(proof.targetOrigin).origin === sourceOrigin) {
      context.addIssue({
        code: 'custom',
        path: ['sourceInventory', 'readOnlyProof', 'targetOrigin'],
        message: 'Migration target must be isolated from the source origin',
      })
    }
    for (const page of value.contentManifest.pages) {
      if (new URL(page.url).origin !== sourceOrigin) {
        context.addIssue({
          code: 'custom',
          path: ['contentManifest', 'pages'],
          message: 'Content provenance crossed the approved source origin',
        })
        break
      }
    }
    if (
      value.crawlerProvenance.checkedUrlCount !==
        value.sourceInventory.pages.length ||
      value.sourceInventory.pages.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['crawlerProvenance', 'checkedUrlCount'],
        message: 'Crawler provenance must cover a positive source URL inventory',
      })
    }
    const sourceUrls = new Set(value.sourceInventory.pages.map(page => page.url))
    const decisions = new Map<string, (typeof value.redirectDecisions)[number]>()
    value.redirectDecisions.forEach((decision, index) => {
      if (decisions.has(decision.sourceUrl) || !sourceUrls.has(decision.sourceUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['redirectDecisions', index, 'sourceUrl'],
          message: 'Each crawled source URL requires exactly one redirect decision',
        })
      }
      decisions.set(decision.sourceUrl, decision)
    })
    if (
      decisions.size !== sourceUrls.size ||
      [...sourceUrls].some(url => !decisions.has(url))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['redirectDecisions'],
        message: 'Redirect decisions must cover every crawled source URL',
      })
    }
    const redirectTargets = new Map(
      value.redirectMap.map(redirect => [redirect.from, redirect.to])
    )
    if (
      [...redirectTargets].some(
        ([sourceUrl, targetUrl]) =>
          !sourceUrls.has(sourceUrl) ||
          decisions.get(sourceUrl)?.decision !== 'redirect' ||
          decisions.get(sourceUrl)?.targetUrl !== targetUrl
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['redirectMap'],
        message: 'Redirect map entries require matching crawler decisions',
      })
    }
    for (const decision of value.redirectDecisions) {
      if (
        decision.decision === 'redirect' &&
        redirectTargets.get(decision.sourceUrl) !== decision.targetUrl
      ) {
        context.addIssue({
          code: 'custom',
          path: ['redirectDecisions'],
          message: 'Redirect decisions must match the immutable redirect map',
        })
        break
      }
      if (
        decision.decision !== 'redirect' &&
        redirectTargets.has(decision.sourceUrl)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['redirectMap'],
          message: 'Every redirect map entry requires a redirect decision',
        })
        break
      }
    }
  })

export const postLaunchVerificationInputSchema = postLaunchCompletedSchema

export type SiteForgeMigrationManifestInput = z.infer<
  typeof siteForgeMigrationManifestInputSchema
>

export const ACACIA_AURORA_MIGRATION_PROOF = Object.freeze({
  sourceUrl: 'https://www.dividendhomes.com',
  targetUrl: 'https://aurora.siteforge.example',
  sourceRole: 'read_only' as const,
  targetRole: 'write_target' as const,
  allowedSourceMethods: Object.freeze(['GET', 'HEAD', 'OPTIONS'] as const),
  sourceMutationAllowed: false as const,
})

export function assertAcaciaCannotBeMutationTarget(input: {
  sourceUrl: string
  targetUrl: string
  method: string
}) {
  const sourceOrigin = new URL(input.sourceUrl).origin
  const targetOrigin = new URL(input.targetUrl).origin
  if (sourceOrigin === targetOrigin) {
    throw new Error('Acacia source and Aurora target must have different origins')
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) {
    throw new Error(`${input.method.toUpperCase()} is prohibited on the migration source`)
  }
  return Object.freeze({ sourceOrigin, targetOrigin, sourceReadOnly: true as const })
}
