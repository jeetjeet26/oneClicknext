import type {
  SiteForgeDirectorSnapshot,
  SiteForgeDirectorStage,
} from "@/utils/siteforge/director/contracts";
import type {
  GuidedAttachment,
  GuidedCreativeDirectionOverview,
  GuidedJourneyState,
  GuidedJourneyStateV1,
  GuidedQuestion,
} from "@/utils/siteforge/guided/contracts";
import type {
  GuidedJourneyProjection,
  ScoredDirection,
} from "@/utils/siteforge/guided/journey";

export const SITEFORGE_GUIDED_STEP_IDS = [
  "conversation",
  "visuals",
  "recommendation",
  "build",
  "progress",
  "preview",
  "launch",
] as const;

export type SiteForgeGuidedStepId = (typeof SITEFORGE_GUIDED_STEP_IDS)[number];

export type SiteForgeGuidedRecommendation = {
  revision: number;
  headline: string;
  summary: string;
  audience: string;
  visualDirection: string;
  pages: Array<{ name: string; purpose: string }>;
  priorities: string[];
  openItems: string[];
};

export type SiteForgeGuidedSnapshotResponse = {
  state: GuidedJourneyState;
  question: GuidedQuestion | null;
  creativeDirection: GuidedCreativeDirectionOverview | null;
  journey: GuidedJourneyProjection;
  attachmentRoutes: {
    images: string;
    floorPlans: string;
  };
};

export type SiteForgeGuidedConversationResponse =
  SiteForgeGuidedSnapshotResponse & {
    duplicate: boolean;
    routedAttachments: Array<{
      attachment: GuidedAttachment;
      route: string;
      reason: string;
    }>;
  };

export type SiteForgeGuidedPrepareResponse = SiteForgeGuidedSnapshotResponse & {
  duplicate: boolean;
  scoredDirections: ScoredDirection[];
};

export type SiteForgeGuidedConfirmResponse = SiteForgeGuidedSnapshotResponse & {
  duplicate: boolean;
};

export type SiteForgeGuidedDirectionEditResponse =
  SiteForgeGuidedSnapshotResponse & {
    duplicate: boolean;
    editOutcome?: {
      outcome: "patch" | "clarification" | "rejection";
      summary?: string;
      question?: string;
      reason?: string;
    };
  };

export type SiteForgeGuidedJourneyItem = {
  id: SiteForgeGuidedStepId;
  label: string;
  detail: string;
  state: "complete" | "current" | "upcoming" | "needs_attention";
};

const STEP_COPY: Record<
  SiteForgeGuidedStepId,
  Pick<SiteForgeGuidedJourneyItem, "label" | "detail">
> = {
  conversation: {
    label: "Conversation",
    detail: "Tell SiteForge what makes this property distinct.",
  },
  visuals: {
    label: "Photos and floor plans",
    detail: "Review the real property imagery and available homes.",
  },
  recommendation: {
    label: "Recommendation",
    detail: "Review the proposed site story, pages, and priorities.",
  },
  build: {
    label: "Build",
    detail: "Confirm the recommendation and start the website build.",
  },
  progress: {
    label: "Progress",
    detail: "Follow the build in clear, plain-language steps.",
  },
  preview: {
    label: "Preview and edit",
    detail: "Review the website and request changes conversationally.",
  },
  launch: {
    label: "Launch",
    detail: "Approve staging and complete the supervised launch.",
  },
};

const DIRECTOR_STEP: Record<SiteForgeDirectorStage, SiteForgeGuidedStepId> = {
  setup: "conversation",
  planning: "recommendation",
  generation: "progress",
  preview: "preview",
  approval: "preview",
  staging: "launch",
  release: "launch",
  production: "launch",
  recovery: "launch",
};

const BACKEND_STEP: Record<
  GuidedJourneyProjection["stage"],
  SiteForgeGuidedStepId
> = {
  conversation: "conversation",
  assets: "visuals",
  recommendation: "recommendation",
  build: "build",
  progress: "progress",
  preview: "preview",
  launch: "launch",
};

export function inferGuidedStep(
  snapshot: SiteForgeDirectorSnapshot | null,
  journey?: GuidedJourneyProjection | null,
): SiteForgeGuidedStepId {
  if (journey) return BACKEND_STEP[journey.stage];
  if (!snapshot) return "conversation";
  return DIRECTOR_STEP[snapshot.stage.key];
}

export function buildGuidedJourney(
  snapshot: SiteForgeDirectorSnapshot | null,
  journey?: GuidedJourneyProjection | null,
): SiteForgeGuidedJourneyItem[] {
  const current = inferGuidedStep(snapshot, journey);
  const currentIndex = SITEFORGE_GUIDED_STEP_IDS.indexOf(current);
  const failed = Boolean(journey?.blocker);

  return SITEFORGE_GUIDED_STEP_IDS.map((id, index) => ({
    id,
    ...STEP_COPY[id],
    state:
      index < currentIndex
        ? "complete"
        : index === currentIndex
          ? failed
            ? "needs_attention"
            : "current"
          : "upcoming",
  }));
}

export function buildPreparedRecommendation(
  state: GuidedJourneyState | GuidedJourneyStateV1 | null,
  scoredDirections: ScoredDirection[] = [],
): SiteForgeGuidedRecommendation | null {
  if (!state?.prepared) return null;
  const answers = state.answers;
  const durableDirections =
    scoredDirections.length > 0
      ? scoredDirections
      : state.prepared.scoredDirections;
  const selectedDirection = durableDirections.find(
    (direction) => direction.id === state.prepared?.recommendedDirectionId,
  );
  const primaryAction = {
    tours: "Schedule a tour",
    applications: "Apply online",
    contact: "Contact the leasing team",
    calls: "Call the property",
  }[answers.primaryAction || "contact"];

  return {
    revision: state.prepared.planRevision,
    headline:
      selectedDirection || state.prepared.recommendedDirectionName
        ? `${selectedDirection?.name || state.prepared.recommendedDirectionName} for ${state.propertyName}`
        : `${state.propertyName} website recommendation`,
    summary:
      answers.objective ||
      "A focused property website grounded in the approved discovery answers.",
    audience: (answers.renterNeeds || []).join(", "),
    visualDirection: [
      selectedDirection?.name,
      state.prepared.recommendationReason,
    ]
      .filter(Boolean)
      .join(" — "),
    pages: (answers.pageScope?.included || []).map((name) => ({
      name,
      purpose: name.toLowerCase().includes("floor")
        ? "Help prospective residents compare available homes and layouts."
        : `Support the approved objective and make ${primaryAction.toLowerCase()} clear.`,
    })),
    priorities: [
      `Primary action: ${primaryAction}`,
      ...(answers.differentiators || []),
      ...(answers.offers || []).map((offer) => `Verified offer: ${offer}`),
    ],
    openItems: [
      ...(answers.constraints || []),
      ...(answers.pageScope?.excluded || []).map(
        (page) => `${page} will stay outside this build.`,
      ),
    ],
  };
}

export function conversationAnswer(
  question: GuidedQuestion | null | undefined,
  draft: unknown,
  attachments: GuidedAttachment[],
): unknown {
  if (!question) return draft;
  if (question.control !== "text") return draft;
  const text = typeof draft === "string" ? draft.trim() : "";
  if (!question.id.includes("reference")) return text;
  const references = attachments
    .filter((attachment) => attachment.kind === "reference")
    .map((attachment) => ({
      label: attachment.name,
      url: attachment.url,
      sourceId: attachment.sourceId,
    }));
  return text || references;
}

const TECHNICAL_ERROR_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  /\b[0-9a-f]{40,}\b/gi,
  /zod(?:error)?/gi,
  /invalid (?:uuid|input syntax)[^.,;]*/gi,
];

export function friendlySiteForgeError(
  value: unknown,
  fallback = "SiteForge could not complete that step. Please try again.",
): string {
  const message =
    typeof value === "string"
      ? value
      : value &&
          typeof value === "object" &&
          "error" in value &&
          typeof value.error === "string"
        ? value.error
        : "";

  if (
    !message ||
    TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    TECHNICAL_ERROR_PATTERNS.forEach((pattern) => {
      pattern.lastIndex = 0;
    });
    return fallback;
  }

  return message.length > 220 ? fallback : message;
}

export function plainSiteForgeProgress(
  stage: string | null | undefined,
  currentStep: string | null | undefined,
): string {
  const value = `${stage || ""} ${currentStep || ""}`.toLowerCase();
  if (/photo|asset|property|context|research/.test(value)) {
    return "Reviewing property details";
  }
  if (/plan|blueprint|structure|design|layout/.test(value)) {
    return "Designing pages and layout";
  }
  if (/content|copy|section|page/.test(value)) {
    return "Writing website content";
  }
  if (/quality|validate|review|certif|check/.test(value)) {
    return "Reviewing website quality";
  }
  if (/preview|render|wordpress/.test(value)) {
    return "Preparing your private preview";
  }
  return "Building your website";
}
