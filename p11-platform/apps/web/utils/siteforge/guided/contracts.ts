import { z } from "zod";
import {
  siteForgeCreativeDirectionSchema,
  siteForgeDirectionPreviewSchema,
} from "@/utils/siteforge/directions/contracts";

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
  selectedDirectionContentHash: z.string().length(64).optional(),
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

export const guidedCreativeDirectionCandidateSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().positive(),
  name: text.max(240),
  direction: siteForgeCreativeDirectionSchema,
  previewManifest: siteForgeDirectionPreviewSchema,
  contentHash: z.string().length(64),
});

export const guidedCreativeDirectionOverviewSchema = z.object({
  directionSetId: z.string().min(1),
  directionSetContentHash: z.string().length(64),
  selected: guidedCreativeDirectionCandidateSchema,
  alternatives: z.array(guidedCreativeDirectionCandidateSchema).max(2),
  recommendationReason: text,
  brandPresentation: z
    .object({
      name: text.max(240),
      logo: z
        .object({
          url: z.string().url(),
          alt: z.string().trim().max(500),
          role: z.enum([
            "primary",
            "secondary",
            "monochrome",
            "mark",
            "favicon",
          ]),
        })
        .nullable(),
      palette: z
        .array(
          z.object({
            role: z.enum([
              "primary",
              "secondary",
              "accent",
              "background",
              "surface",
              "text",
              "muted",
            ]),
            name: text.max(240),
            hex: z.string().regex(/^#[0-9a-f]{6}$/i),
            usage: z.string().trim().max(2_000),
          }),
        )
        .min(1),
      usageGuidelines: z.string().trim().max(4_000),
    })
    .nullable()
    .default(null),
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

export const guidedJourneyStateV1Schema = z.object({
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

export const guidedDecisionControlSchema = z.enum([
  "enum",
  "multiselect",
  "ranking",
  "date",
  "text",
]);

export const guidedDecisionAnswerSchemaSchema = z
  .object({
    type: z.enum(["string", "array", "date"]),
    enum: z.array(text.max(240)).max(50).default([]),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional(),
  })
  .strict();

export const guidedDecisionConditionSchema = z
  .object({
    path: z.string().trim().min(1).max(240),
    operator: z.enum(["equals", "includes", "exists", "missing"]),
    value: z.unknown().optional(),
  })
  .strict();

export const guidedDecisionDefinitionSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,239}$/),
    packKey: z.string().trim().min(1).max(240),
    label: text.max(240),
    prompt: text,
    hypothesis: text.max(3_000),
    provenanceLabel: text.max(500),
    control: guidedDecisionControlSchema,
    answerSchema: guidedDecisionAnswerSchemaSchema,
    options: z
      .array(
        z
          .object({
            value: text.max(240),
            label: text.max(240),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    when: z.array(guidedDecisionConditionSchema).max(20).default([]),
    requiredWhen: z.array(guidedDecisionConditionSchema).max(20).default([]),
    required: z.boolean(),
    inference: z
      .object({
        strategy: z.enum([
          "vertical_profile",
          "pack_recipe",
          "evidence",
          "legacy_adapter",
          "operator",
        ]),
        sourcePath: z.string().trim().min(1).max(240),
      })
      .strict(),
    confidenceThreshold: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(50),
    sensitivity: z.enum(["low", "personal", "regulated"]),
    affectedPlanFields: z
      .array(z.string().trim().min(1).max(240))
      .max(30),
    validation: z
      .object({
        code: z.string().trim().min(1).max(120),
        message: text.max(500),
        remediation: text.max(500),
      })
      .strict(),
  })
  .strict();

export const guidedDecisionAnswerRecordSchema = z
  .object({
    decisionId: z.string().trim().min(1).max(240),
    value: z.unknown(),
    origin: z.enum(["inferred", "operator", "imported", "legacy_adapter"]),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(50),
    actor: z
      .object({
        type: z.enum(["system", "user", "import"]),
        id: z.string().trim().min(1).max(240),
      })
      .strict(),
    confirmedAt: z.string().datetime().nullable(),
  })
  .strict();

export const guidedEvidenceEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    kind: z.string().trim().min(1).max(120),
    label: text.max(500),
    sourceType: z.string().trim().min(1).max(120),
    sourceId: z.string().trim().min(1).max(240),
    url: z.string().trim().url().max(2_048).nullable().default(null),
    observedAt: z.string().datetime({ offset: true }).nullable().default(null),
    freshUntil: z.string().datetime({ offset: true }).nullable().default(null),
    content: z.unknown().optional(),
  })
  .strict();

const siteStorySourceSchema = z
  .object({
    type: z.enum([
      "vertical_profile",
      "vertical_pack",
      "evidence",
      "operator",
      "locked_default",
    ]),
    id: z.string().trim().min(1).max(240),
    path: z.string().trim().min(1).max(500),
  })
  .strict();

export const siteStoryMaterialitySchema = z.enum([
  "low",
  "material",
  "critical",
]);

export const siteStoryDecisionSchema = z
  .object({
    id: z.string().trim().regex(/^story\.[a-z0-9_.-]+$/),
    topic: z.enum([
      "narrative",
      "audience_need",
      "proof_priority",
      "journey_emphasis",
      "page_intent",
    ]),
    prompt: text.max(2_000),
    proposedValue: z.unknown(),
    source: siteStorySourceSchema,
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(50),
    confidence: z.number().min(0).max(1),
    materiality: siteStoryMaterialitySchema,
    affectedPaths: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  })
  .strict();

export const siteStoryResolutionSchema = z
  .object({
    decisionId: z.string().trim().regex(/^story\.[a-z0-9_.-]+$/),
    status: z.enum([
      "locked_default",
      "inferred",
      "operator_confirmed",
      "needs_confirmation",
    ]),
    value: z.unknown(),
    source: siteStorySourceSchema,
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(50),
    confidence: z.number().min(0).max(1),
    materiality: siteStoryMaterialitySchema,
    affectedPaths: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  })
  .strict();

export const SITE_STORY_LOCKED_DEFAULT_KEYS = [
  "goals",
  "cta",
  "pages",
  "legal",
  "accessibility",
  "analytics",
  "seo",
] as const;

export const siteStoryLockedDefaultSchema = z
  .object({
    key: z.enum(SITE_STORY_LOCKED_DEFAULT_KEYS),
    locked: z.literal(true),
    value: z.unknown(),
    source: siteStorySourceSchema,
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(50),
    confidence: z.number().min(0).max(1),
    affectedPaths: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  })
  .strict();

export const siteStoryPageIntentSchema = z
  .object({
    id: z.string().trim().regex(/^story\.page-intent\.[a-z0-9_.-]+$/),
    role: z.enum([
      "orient",
      "evaluate_residences",
      "evaluate_homes",
      "evaluate_amenities",
      "evaluate_location",
      "establish_trust",
      "convert",
    ]),
    visitorJob: text.max(1_000),
    narrativeJob: text.max(1_000),
    desiredAction: text.max(500),
    required: z.boolean(),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(50),
    affectedPaths: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  })
  .strict();

const laneRequiredPageIntents = {
  multifamily: [
    "orient",
    "evaluate_residences",
    "evaluate_amenities",
    "evaluate_location",
    "convert",
  ],
  for_sale: [
    "orient",
    "evaluate_homes",
    "evaluate_location",
    "establish_trust",
    "convert",
  ],
} as const;

export const siteStoryContractSchema = z
  .object({
    contractVersion: z.literal("3.0"),
    id: z.string().trim().regex(/^site-story\.[a-z0-9_.-]+$/),
    lane: z.enum(["multifamily", "for_sale"]),
    premise: text.max(2_000),
    audience: z
      .object({
        label: text.max(240),
        practicalNeeds: textList.min(1),
      })
      .strict(),
    promise: text.max(2_000),
    narrativeArc: z.array(text.max(1_000)).min(3).max(8),
    pageIntents: z.array(siteStoryPageIntentSchema).min(5).max(20),
    lockedDefaults: z.array(siteStoryLockedDefaultSchema).length(7),
    decisions: z.array(siteStoryDecisionSchema).max(30),
    resolutions: z.array(siteStoryResolutionSchema).max(30),
  })
  .strict()
  .superRefine((story, ctx) => {
    const lockedKeys = new Set(story.lockedDefaults.map((item) => item.key));
    for (const key of SITE_STORY_LOCKED_DEFAULT_KEYS) {
      if (!lockedKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["lockedDefaults"],
          message: `Missing locked default: ${key}`,
        });
      }
    }
    const roles = new Set(story.pageIntents.map((intent) => intent.role));
    for (const role of laneRequiredPageIntents[story.lane]) {
      if (!roles.has(role)) {
        ctx.addIssue({
          code: "custom",
          path: ["pageIntents"],
          message: `${story.lane} requires the ${role} page intent`,
        });
      }
    }
    const decisionIds = new Set(story.decisions.map((item) => item.id));
    for (const resolution of story.resolutions) {
      if (!decisionIds.has(resolution.decisionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["resolutions"],
          message: `Resolution has no decision: ${resolution.decisionId}`,
        });
      }
    }
  });

export const siteStoryIdentitySchema = z
  .object({
    id: z.string().trim().regex(/^site-story\.[a-z0-9_.-]+$/),
    contractVersion: z.literal("3.0"),
    contentHash: z.string().length(64),
  })
  .strict();

export const guidedSourcesV2Schema = guidedSourcesSchema.extend({
  verticalProfile: z
    .object({
      id: z.string().min(1),
      version: z.number().int().positive(),
      contentHash: z.string().length(64),
    })
    .strict(),
  verticalPack: z
    .object({
      registryVersion: z.number().int().positive(),
      contentHash: z.string().length(64),
      packs: z
        .array(
          z
            .object({
              key: z.string().min(1).max(240),
              version: z.number().int().positive(),
              contentHash: z.string().length(64),
            })
            .strict(),
        )
        .min(5),
    })
    .strict(),
  evidence: z
    .object({
      contextHash: z.string().length(64),
      entries: z.array(guidedEvidenceEntrySchema).max(500),
    })
    .strict(),
});

export const guidedTurnV2Schema = z.object({
  id: z.string().min(1),
  clientRequestId: z.string().trim().min(1).max(160),
  role: z.enum(["user", "assistant"]),
  field: z.string().trim().min(1).max(240).nullable(),
  content: text.max(5_000),
  createdAt: z.string().datetime(),
});

export const guidedJourneyStateV2Schema = z.object({
  schemaVersion: z.literal(2),
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
  decisions: z.array(guidedDecisionDefinitionSchema).max(100),
  decisionAnswers: z.record(
    z.string().trim().min(1).max(240),
    guidedDecisionAnswerRecordSchema,
  ),
  decisionSetHash: z.string().length(64),
  answerHash: z.string().length(64),
  discoveryHash: z.string().length(64),
  turns: z.array(guidedTurnV2Schema).max(200),
  attachments: z.array(guidedAttachmentSchema).max(50),
  sources: guidedSourcesV2Schema,
  preparation: guidedPreparationCheckpointSchema.nullable().default(null),
  prepared: guidedPreparedPackageSchema
    .extend({
      verticalProfileContentHash: z.string().length(64),
      verticalPackContentHash: z.string().length(64),
      decisionSetHash: z.string().length(64),
      answerHash: z.string().length(64),
      discoveryHash: z.string().length(64),
    })
    .nullable()
    .default(null),
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

// Kept as the exact V1 parser for durable historical snapshots.
export const guidedJourneyStateSchema = guidedJourneyStateV1Schema;

export const guidedConversationRequestSchema = z
  .object({
    clientRequestId: z.string().trim().min(1).max(160),
    expectedRevision: z.number().int().nonnegative(),
    decisionId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{2,239}$/)
      .optional(),
    field: z.string().trim().min(1).max(240).optional(),
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

export const guidedDirectionEditRequestSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(160),
  instruction: z.string().trim().min(2).max(2_000).optional(),
  alternativeDirectionId: z.guid().optional(),
  expectedRevision: z.number().int().nonnegative(),
  expected: z.object({
    directionSetContentHash: z.string().length(64),
    selectedDirectionContentHash: z.string().length(64),
  }),
}).refine(
  value =>
    Boolean(value.instruction) !== Boolean(value.alternativeDirectionId),
  {
    message: "Provide either an edit instruction or one alternative direction.",
  },
);

export const guidedQuestionV1Schema = z.object({
  field: guidedDiscoveryFieldSchema,
  question: text,
  why: text,
  optional: z.boolean(),
});

export const guidedQuestionSchema = guidedDecisionDefinitionSchema.extend({
  field: z.string().trim().min(1).max(240),
  question: text,
  why: text,
  optional: z.boolean(),
  currentAnswer: guidedDecisionAnswerRecordSchema.nullable(),
});

export type GuidedAnswers = z.infer<typeof guidedAnswersSchema>;
export type GuidedAttachment = z.infer<typeof guidedAttachmentSchema>;
export type GuidedDiscoveryField = z.infer<typeof guidedDiscoveryFieldSchema>;
export type GuidedJourneyStateV1 = z.infer<typeof guidedJourneyStateV1Schema>;
export type GuidedJourneyState = z.infer<typeof guidedJourneyStateV2Schema>;
export type GuidedDecisionDefinition = z.infer<
  typeof guidedDecisionDefinitionSchema
>;
export type GuidedDecisionAnswerRecord = z.infer<
  typeof guidedDecisionAnswerRecordSchema
>;
export type GuidedQuestionV1 = z.infer<typeof guidedQuestionV1Schema>;
export type GuidedQuestion = z.infer<typeof guidedQuestionSchema>;
export type GuidedCreativeDirectionOverview = z.infer<
  typeof guidedCreativeDirectionOverviewSchema
>;
export type SiteStoryContract = z.infer<typeof siteStoryContractSchema>;
export type SiteStoryDecision = z.infer<typeof siteStoryDecisionSchema>;
export type SiteStoryIdentity = z.infer<typeof siteStoryIdentitySchema>;
