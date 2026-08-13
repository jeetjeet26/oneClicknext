import { z } from "zod";

export const GUIDED_DISCOVERY_FIELDS = [
  "objective",
  "successSignal",
  "renterNeeds",
  "primaryAction",
  "pageScope",
  "differentiators",
  "offers",
  "deadline",
  "references",
  "constraints",
] as const;

export const guidedDiscoveryFieldSchema = z.enum(GUIDED_DISCOVERY_FIELDS);

const text = z.string().trim().min(1).max(2_000);
const textList = z.array(text).max(30);

export const guidedReferenceSchema = z.object({
  label: text.max(240),
  url: z.string().trim().url().max(2_048).optional(),
  sourceId: z.string().trim().min(1).max(240).optional(),
  notes: z.string().trim().max(2_000).optional(),
});

export const guidedAttachmentSchema = z.object({
  kind: z.enum(["reference", "document", "image", "floor_plan"]),
  name: text.max(240),
  url: z.string().trim().url().max(2_048).optional(),
  sourceId: z.string().trim().min(1).max(240).optional(),
  mediaType: z.string().trim().min(1).max(160).optional(),
  sizeBytes: z.number().int().nonnegative().max(100_000_000).optional(),
});

export const guidedAnswersSchema = z.object({
  objective: text.nullable().default(null),
  successSignal: text.nullable().default(null),
  renterNeeds: textList.nullable().default(null),
  primaryAction: z
    .enum(["tours", "applications", "contact", "calls"])
    .nullable()
    .default(null),
  pageScope: z
    .object({
      included: textList.min(1),
      excluded: textList.default([]),
    })
    .nullable()
    .default(null),
  differentiators: textList.nullable().default(null),
  offers: textList.nullable().default(null),
  deadline: z
    .object({
      date: z.string().date().nullable(),
      flexibility: z.enum(["fixed", "target", "flexible"]),
    })
    .nullable()
    .default(null),
  references: z.array(guidedReferenceSchema).nullable().default(null),
  constraints: textList.nullable().default(null),
});

export const guidedTurnSchema = z.object({
  id: z.string().min(1),
  clientRequestId: z.string().trim().min(1).max(160),
  role: z.enum(["user", "assistant"]),
  field: guidedDiscoveryFieldSchema.nullable(),
  content: text.max(5_000),
  createdAt: z.string().datetime(),
});

export const guidedSourcesSchema = z.object({
  onboardingSnapshotId: z.string().min(1),
  onboardingSnapshotHash: z.string().length(64),
  brandAssetId: z.string().min(1),
  brandContractHash: z.string().length(64),
});

export const guidedScoredDirectionSchema = z.object({
  id: z.string().min(1),
  name: text.max(240),
  score: z.number().min(0).max(100),
  reason: text,
});

export const guidedPreparedPackageSchema = z.object({
  idempotencyKey: z.string().min(1).max(240),
  briefVersionId: z.string().min(1),
  briefContentHash: z.string().length(64),
  directionSetId: z.string().min(1),
  directionSetContentHash: z.string().length(64),
  recommendedDirectionId: z.string().min(1),
  recommendedDirectionName: text.max(240).optional(),
  recommendedDirectionScore: z.number().min(0).max(100),
  recommendationReason: text,
  scoredDirections: z.array(guidedScoredDirectionSchema).max(12).default([]),
  planId: z.string().min(1),
  planVersionId: z.string().min(1),
  planRevision: z.number().int().positive(),
  planContentHash: z.string().length(64),
  preparedAt: z.string().datetime(),
});

export const guidedGenerationSchema = z.object({
  jobId: z.string().min(1),
  status: z.string().min(1),
  workflowRunId: z.string().nullable().optional(),
  duplicate: z.boolean().default(false),
  startedAt: z.string().datetime(),
});

export const guidedPreparationCheckpointSchema = z.object({
  idempotencyKey: z.string().min(1).max(240),
  briefVersionId: z.string().min(1).nullable().default(null),
  briefContentHash: z.string().length(64).nullable().default(null),
  directionSetId: z.string().min(1).nullable().default(null),
  planId: z.string().min(1).nullable().default(null),
  updatedAt: z.string().datetime(),
});

export const guidedJourneyStateSchema = z.object({
  schemaVersion: z.literal(1),
  websiteId: z.string().min(1),
  propertyId: z.string().min(1),
  orgId: z.string().min(1),
  propertyName: text.max(240),
  revision: z.number().int().nonnegative(),
  status: z.enum([
    "discovering",
    "ready_to_prepare",
    "preparing",
    "ready_to_build",
    "building",
    "needs_attention",
  ]),
  answers: guidedAnswersSchema,
  turns: z.array(guidedTurnSchema).max(100),
  attachments: z.array(guidedAttachmentSchema).max(50),
  sources: guidedSourcesSchema,
  preparation: guidedPreparationCheckpointSchema.nullable().default(null),
  prepared: guidedPreparedPackageSchema.nullable().default(null),
  generation: guidedGenerationSchema.nullable().default(null),
  lastError: z
    .object({
      kind: z.enum(["temporary", "source_changed", "needs_attention"]),
      message: text,
      retryable: z.boolean(),
    })
    .nullable()
    .default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const guidedConversationRequestSchema = z
  .object({
    clientRequestId: z.string().trim().min(1).max(160),
    expectedRevision: z.number().int().nonnegative(),
    field: guidedDiscoveryFieldSchema.optional(),
    answer: z.unknown(),
    attachments: z.array(guidedAttachmentSchema).max(20).default([]),
  })
  .refine((value) => JSON.stringify(value.answer).length <= 5_000, {
    path: ["answer"],
    message: "Answer is too long",
  });

export const guidedPrepareRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
});

export const guidedConfirmRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
  expected: z.object({
    briefContentHash: z.string().length(64),
    directionSetContentHash: z.string().length(64),
    planContentHash: z.string().length(64),
  }),
});

export const guidedQuestionSchema = z.object({
  field: guidedDiscoveryFieldSchema,
  question: text,
  why: text,
  optional: z.boolean(),
});

export type GuidedAnswers = z.infer<typeof guidedAnswersSchema>;
export type GuidedAttachment = z.infer<typeof guidedAttachmentSchema>;
export type GuidedDiscoveryField = z.infer<typeof guidedDiscoveryFieldSchema>;
export type GuidedJourneyState = z.infer<typeof guidedJourneyStateSchema>;
export type GuidedQuestion = z.infer<typeof guidedQuestionSchema>;
