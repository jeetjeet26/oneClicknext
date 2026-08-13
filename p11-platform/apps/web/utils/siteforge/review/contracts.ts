import { z } from 'zod'

export const reviewPermissionSchema = z.enum(['view', 'comment', 'decide'])
export type ReviewPermission = z.infer<typeof reviewPermissionSchema>

export const reviewDecisionSchema = z.enum([
  'approved',
  'approved_with_notes',
  'changes_requested',
])
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>

export const reviewCommentCategorySchema = z.enum([
  'general',
  'brand',
  'copy',
  'layout',
  'image',
  'conversion',
  'legal',
  'accessibility',
  'seo',
  'bug',
])

export const reviewCommentStatusSchema = z.enum([
  'open',
  'accepted',
  'clarification_needed',
  'rejected',
  'resolved',
  'verified',
])

export const revisionRoundStatusSchema = z.enum([
  'collecting',
  'ready_for_work',
  'in_progress',
  'ready_for_verification',
  'verified',
  'closed',
])

export const viewportSchema = z.enum(['desktop', 'tablet', 'mobile'])

const optionalEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .optional()
  .nullable()

export const createReviewSessionSchema = z
  .object({
    websiteId: z.string().uuid(),
    artifactId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(160),
    instructions: z.string().trim().max(4_000).optional().nullable(),
    clientSafeSummary: z
      .record(z.string().max(80), z.unknown())
      .optional()
      .default({}),
    closesAt: z.iso.datetime().optional().nullable(),
  })
  .strict()

export const issueReviewTokenSchema = z
  .object({
    reviewerName: z.string().trim().min(1).max(160).optional().nullable(),
    reviewerEmail: optionalEmailSchema,
    permissions: z
      .array(reviewPermissionSchema)
      .min(1)
      .max(3)
      .transform(permissions => [...new Set(permissions)]),
    expiresAt: z.iso.datetime(),
  })
  .strict()

export const createReviewCommentSchema = z
  .object({
    pagePath: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^\/(?!\/)/, 'Page path must be root-relative'),
    sectionId: z.string().trim().min(1).max(160).optional().nullable(),
    parentCommentId: z.string().uuid().optional().nullable(),
    revisionRoundId: z.string().uuid().optional().nullable(),
    viewport: viewportSchema.optional().nullable(),
    anchor: z.record(z.string().max(80), z.unknown()).optional().default({}),
    body: z.string().trim().min(1).max(8_000),
    category: reviewCommentCategorySchema.optional().default('general'),
  })
  .strict()

export const createClientDecisionSchema = z
  .object({
    decision: reviewDecisionSchema,
    rationale: z.string().trim().min(1).max(8_000),
    artifactId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    certificationId: z.string().uuid(),
    canonicalUrl: z.string().url(),
  })
  .strict()

export const semanticOperationSchema = z
  .object({
    operation: z.string().trim().min(1).max(120),
    target: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000).optional(),
    pagePath: z.string().trim().max(500).optional(),
    sectionId: z.string().trim().max(160).optional(),
  })
  .strict()

export const updateCommentTraceSchema = z
  .object({
    status: reviewCommentStatusSchema,
    interpretation: z.string().trim().min(1).max(4_000),
    semanticOperations: z.array(semanticOperationSchema).max(100),
    resultingArtifactId: z.string().uuid().optional().nullable(),
    resultingContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === 'verified' &&
      (!value.resultingArtifactId ||
        !value.resultingContentHash ||
        value.semanticOperations.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Verified comments require semantic operations and an exact resulting artifact',
      })
    }
  })

export const createRevisionRoundSchema = z
  .object({
    requestedByName: z.string().trim().min(1).max(160).optional().nullable(),
    requestedByEmail: optionalEmailSchema,
    assignedTo: z.string().uuid().optional().nullable(),
    dueAt: z.iso.datetime().optional().nullable(),
  })
  .strict()

export const updateRevisionRoundSchema = z
  .object({
    status: revisionRoundStatusSchema.optional(),
    assignedTo: z.string().uuid().optional().nullable(),
    dueAt: z.iso.datetime().optional().nullable(),
    resultingArtifactId: z.string().uuid().optional().nullable(),
    resultingContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .nullable(),
  })
  .strict()

export type ClientSafeSection = {
  id: string
  type: string
  acfBlock: string
  label?: string
  variant?: string
  cssClasses?: string[]
  content: Record<string, unknown>
}

export type ClientSafePage = {
  slug: string
  title: string
  sections: ClientSafeSection[]
}

export type ClientSafePreview = {
  pages: ClientSafePage[]
  designSystem?: Record<string, unknown>
}

export type PublicReviewComment = {
  id: string
  parentCommentId: string | null
  revisionRoundId: string | null
  authorType: 'client' | 'operator' | 'system'
  authorName: string
  pagePath: string
  sectionId: string | null
  viewport: string | null
  body: string
  category: string
  status: string
  createdAt: string
  trace: {
    interpretation: string | null
    semanticOperations: Array<{
      operation: string
      target: string
      summary?: string
      pagePath?: string
      sectionId?: string
    }>
    resultingArtifactId: string | null
    verificationStatus: string
  }
}

export type PublicReviewData = {
  session: {
    id: string
    title: string
    instructions: string | null
    status: string
    openedAt: string
    closesAt: string | null
    summary: Record<string, unknown>
  }
  artifact: {
    id: string
    version: number
    contentHash: string
    isCurrent: boolean
  }
  canonicalRelease: {
    artifactId: string
    contentHash: string
    certificationId: string
    certificationPolicy: string
    certificationReportHash: string
    certifiedAt: string
    url: string
    exact: boolean
  } | null
  permissions: ReviewPermission[]
  reviewer: {
    name: string | null
  }
  preview: ClientSafePreview
  rounds: Array<{
    id: string
    number: number
    status: string
    requestedByName: string | null
    dueAt: string | null
    resultingArtifactId: string | null
    disposition: {
      open: number
      accepted: number
      rejected: number
      verified: number
    }
  }>
  comments: PublicReviewComment[]
  decisions: Array<{
    id: string
    decision: ReviewDecision
    rationale: string
    reviewerName: string | null
    createdAt: string
    artifactId: string
    contentHash: string
    certificationId: string | null
    certificationReportHash: string | null
    canonicalUrl: string | null
    certifiedAt: string | null
    isCurrentArtifact: boolean
  }>
  clientApproval: {
    decision: ReviewDecision
    rationale: string
    recordedAt: string
    artifactId: string
    contentHash: string
    certificationId: string
    canonicalUrl: string
    validForCurrentArtifact: boolean
  } | null
  notice: string | null
}
