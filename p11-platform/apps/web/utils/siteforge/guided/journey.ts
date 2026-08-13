import { z } from "zod";
import { findFairHousingViolations } from "@/utils/compliance/fair-housing";
import {
  GUIDED_DISCOVERY_FIELDS,
  guidedAnswersSchema,
  guidedReferenceSchema,
  type GuidedAnswers,
  type GuidedDiscoveryField,
  type GuidedJourneyState,
  type GuidedQuestion,
} from "./contracts";
import { siteForgeBriefSchema, type SiteForgeBrief } from "../briefs/contracts";

const QUESTIONS: Record<GuidedDiscoveryField, GuidedQuestion> = {
  objective: {
    field: "objective",
    question: "What is the most important job this website should do?",
    why: "This keeps the recommendation focused on one business outcome.",
    optional: false,
  },
  successSignal: {
    field: "successSignal",
    question: "What result would tell you the new site is working?",
    why: "A concrete signal gives SiteForge a useful measure of success.",
    optional: false,
  },
  renterNeeds: {
    field: "renterNeeds",
    question: "What practical information do prospective residents need most?",
    why: "Focus on housing needs and decisions, not protected-class targeting.",
    optional: false,
  },
  primaryAction: {
    field: "primaryAction",
    question:
      "What should a visitor do first: schedule a tour, apply, contact you, or call?",
    why: "The primary action determines the site’s conversion path.",
    optional: false,
  },
  pageScope: {
    field: "pageScope",
    question:
      "Which pages must be included, and is there anything you want left out?",
    why: "This sets the site boundary before SiteForge recommends a structure.",
    optional: false,
  },
  differentiators: {
    field: "differentiators",
    question:
      "Which verified property strengths should receive the most attention?",
    why: "SiteForge will use these as emphasis, not invent new claims.",
    optional: false,
  },
  offers: {
    field: "offers",
    question: "Are there any current, verified offers to include?",
    why: "Offers are treated as time-sensitive facts and may be omitted.",
    optional: true,
  },
  deadline: {
    field: "deadline",
    question: "Is there a target launch date, and how flexible is it?",
    why: "This helps set expectations without changing production launch controls.",
    optional: true,
  },
  references: {
    field: "references",
    question:
      "Do you have any reference sites, documents, or brand notes to consider?",
    why: "References guide interpretation but never override verified property truth.",
    optional: true,
  },
  constraints: {
    field: "constraints",
    question:
      "Are there any legal, content, integration, or approval constraints we should know?",
    why: "Constraints are carried into the hidden brief and implementation plan.",
    optional: true,
  },
};

const REQUIRED_FIELDS = new Set<GuidedDiscoveryField>([
  "objective",
  "successSignal",
  "renterNeeds",
  "primaryAction",
  "pageScope",
  "differentiators",
]);

function isAnswered(
  answers: GuidedAnswers,
  field: GuidedDiscoveryField,
): boolean {
  const value = answers[field];
  return value !== null;
}

export function nextGuidedQuestion(
  answers: GuidedAnswers,
): GuidedQuestion | null {
  const field = GUIDED_DISCOVERY_FIELDS.find(
    (item) => !isAnswered(answers, item),
  );
  return field ? QUESTIONS[field] : null;
}

export function guidedDiscoveryProgress(answers: GuidedAnswers) {
  const answered = GUIDED_DISCOVERY_FIELDS.filter((field) =>
    isAnswered(answers, field),
  ).length;
  const requiredComplete = [...REQUIRED_FIELDS].every((field) =>
    isAnswered(answers, field),
  );
  return {
    answered,
    total: GUIDED_DISCOVERY_FIELDS.length,
    percent: Math.round((answered / GUIDED_DISCOVERY_FIELDS.length) * 100),
    requiredComplete,
    complete: answered === GUIDED_DISCOVERY_FIELDS.length,
  };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  if (/^(none|no|not applicable|n\/a)$/i.test(value.trim())) return [];
  return value
    .split(/\n|,|;/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GuidedJourneyError(
      `${label} needs a short answer`,
      "needs_attention",
    );
  }
  return value.trim();
}

function assertFairHousingSafe(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const violations = findFairHousingViolations(text);
  if (violations.length) {
    throw new GuidedJourneyError(
      "Please describe practical housing needs without targeting or excluding protected groups.",
      "needs_attention",
      false,
      violations,
    );
  }
}

function primaryAction(value: unknown): GuidedAnswers["primaryAction"] {
  const normalized = requireText(value, "The primary action").toLowerCase();
  if (/tour/.test(normalized)) return "tours";
  if (/appl/.test(normalized)) return "applications";
  if (/call|phone/.test(normalized)) return "calls";
  if (/contact|email|message|lead/.test(normalized)) return "contact";
  throw new GuidedJourneyError(
    "Choose schedule a tour, apply, contact the leasing team, or call.",
    "needs_attention",
  );
}

function pageScope(value: unknown): NonNullable<GuidedAnswers["pageScope"]> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const included = list(record.included);
    if (!included.length) {
      throw new GuidedJourneyError(
        "Include at least one page",
        "needs_attention",
      );
    }
    return { included, excluded: list(record.excluded) };
  }
  const included = list(value);
  if (!included.length) {
    throw new GuidedJourneyError(
      "Include at least one page",
      "needs_attention",
    );
  }
  return { included, excluded: [] };
}

function deadline(value: unknown): NonNullable<GuidedAnswers["deadline"]> {
  if (
    typeof value === "string" &&
    /^(none|no|flexible|no deadline)$/i.test(value.trim())
  ) {
    return { date: null, flexibility: "flexible" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return z
      .object({
        date: z.string().date().nullable(),
        flexibility: z.enum(["fixed", "target", "flexible"]).default("target"),
      })
      .parse({
        date: record.date || null,
        flexibility: record.flexibility || "target",
      });
  }
  const date = requireText(value, "The launch date");
  if (!z.string().date().safeParse(date).success) {
    throw new GuidedJourneyError(
      "Use a date in YYYY-MM-DD format, or say the timing is flexible.",
      "needs_attention",
    );
  }
  return { date, flexibility: "target" };
}

function references(value: unknown): NonNullable<GuidedAnswers["references"]> {
  if (typeof value === "string") {
    if (/^(none|no|n\/a)$/i.test(value.trim())) return [];
    const items = list(value);
    return items.map((item, index) => {
      const parsedUrl = z.string().url().safeParse(item);
      return guidedReferenceSchema.parse(
        parsedUrl.success
          ? { label: `Reference ${index + 1}`, url: item }
          : { label: item },
      );
    });
  }
  if (!Array.isArray(value)) return [];
  return z.array(guidedReferenceSchema).max(30).parse(value);
}

export function parseGuidedAnswer(
  field: GuidedDiscoveryField,
  value: unknown,
): GuidedAnswers[GuidedDiscoveryField] {
  assertFairHousingSafe(value);
  switch (field) {
    case "objective":
      return requireText(value, "The objective");
    case "successSignal":
      return requireText(value, "The success signal");
    case "renterNeeds": {
      const values = list(value);
      if (!values.length) {
        throw new GuidedJourneyError(
          "Add at least one practical renter information need",
          "needs_attention",
        );
      }
      return values;
    }
    case "primaryAction":
      return primaryAction(value);
    case "pageScope":
      return pageScope(value);
    case "differentiators": {
      const values = list(value);
      if (!values.length) {
        throw new GuidedJourneyError(
          "Choose at least one verified property strength",
          "needs_attention",
        );
      }
      return values;
    }
    case "offers":
    case "constraints":
      return list(value);
    case "deadline":
      return deadline(value);
    case "references":
      return references(value);
  }
}

export function updateGuidedAnswers(
  answers: GuidedAnswers,
  field: GuidedDiscoveryField,
  value: unknown,
): GuidedAnswers {
  return guidedAnswersSchema.parse({
    ...answers,
    [field]: parseGuidedAnswer(field, value),
  });
}

export function inferGuidedAnswersFromTruth(input: {
  brandDifferentiators?: string[];
  renterPriorities?: string[];
}): GuidedAnswers {
  const safePriorities = (input.renterPriorities || []).filter(
    (value) => findFairHousingViolations(value).length === 0,
  );
  const safeDifferentiators = (input.brandDifferentiators || []).filter(
    (value) => findFairHousingViolations(value).length === 0,
  );
  return guidedAnswersSchema.parse({
    renterNeeds: safePriorities.length ? safePriorities.slice(0, 8) : null,
    differentiators: safeDifferentiators.length
      ? safeDifferentiators.slice(0, 8)
      : null,
  });
}

export function buildGuidedBrief(input: {
  propertyName: string;
  answers: GuidedAnswers;
  attachmentReferences?: Array<{
    label: string;
    url?: string;
    sourceId?: string;
    notes?: string;
  }>;
}): SiteForgeBrief {
  const progress = guidedDiscoveryProgress(input.answers);
  if (!progress.complete) {
    throw new GuidedJourneyError(
      "Finish the remaining discovery questions before preparing a recommendation.",
      "needs_attention",
    );
  }
  const answers = input.answers;
  const actionLabel = {
    tours: "Schedule a tour",
    applications: "Apply now",
    contact: "Contact the leasing team",
    calls: "Call the property",
  }[answers.primaryAction!];
  const brief = siteForgeBriefSchema.parse({
    title: `${input.propertyName} website brief`,
    summary: answers.objective,
    objectives: [
      {
        statement: answers.objective,
        priority: "primary",
        successSignal: answers.successSignal,
      },
      ...answers.differentiators!.map((statement) => ({
        statement: `Emphasize verified property strength: ${statement}`,
        priority: "secondary" as const,
        successSignal: `Support ${answers.successSignal!.toLowerCase()} with sourced property proof`,
      })),
    ],
    audiences: [
      {
        segment: "Prospective residents",
        needs: answers.renterNeeds,
        objections: [],
      },
    ],
    conversion: {
      primaryAction: actionLabel,
      secondaryActions: ["Contact the leasing team"],
      funnelNotes: `Make ${actionLabel.toLowerCase()} clear and accessible without unsupported urgency.`,
    },
    scope: {
      includedPages: answers.pageScope!.included,
      excludedItems: answers.pageScope!.excluded,
    },
    stakeholders: [],
    approvers: [],
    launchTarget: {
      targetDate: answers.deadline!.date,
      timezone: "UTC",
      flexibility: answers.deadline!.flexibility,
    },
    legalConstraints: [
      {
        name: "Fair Housing",
        requirement:
          "Use practical housing needs and verified property facts; do not target or exclude protected classes.",
        blocking: true,
      },
      ...answers.constraints!.map((item) => ({
        name: "Operator constraint",
        requirement: item,
        blocking: true,
      })),
      ...answers.offers!.map((item) => ({
        name: "Time-sensitive verified offer",
        requirement: `Publish only while current and source-verified: ${item}`,
        blocking: false,
      })),
    ],
    integrationConstraints: [],
    references: [...answers.references!, ...(input.attachmentReferences || [])],
    kpis: [
      {
        name: answers.successSignal,
        target: "Improve from the current measured baseline",
        measurement: answers.successSignal,
      },
    ],
  });
  const violations = findFairHousingViolations(JSON.stringify(brief));
  if (violations.length) {
    throw new GuidedJourneyError(
      "The prepared brief contains audience language that must be rewritten as practical housing needs.",
      "needs_attention",
      false,
      violations,
    );
  }
  return brief;
}

export type ScoredDirection = {
  id: string;
  name: string;
  score: number;
  reason: string;
};

export function scoreGuidedDirections(
  directions: Array<{
    id: string;
    name: string;
    direction: {
      layout?: { density?: string };
      cta?: { label?: string };
      voice?: { traits?: string[] };
    };
  }>,
  answers: GuidedAnswers,
): ScoredDirection[] {
  const desiredAction =
    answers.primaryAction === "tours" ? "tour" : answers.primaryAction;
  return directions
    .map((candidate, index) => {
      const searchable = JSON.stringify(candidate).toLowerCase();
      const conversionFit =
        desiredAction && searchable.includes(desiredAction) ? 12 : 0;
      const clarityFit = /clar|useful|conversion|focused/.test(searchable)
        ? 8
        : 0;
      const score = Math.min(100, 72 + conversionFit + clarityFit - index);
      return {
        id: candidate.id,
        name: candidate.name,
        score,
        reason:
          conversionFit > 0
            ? `Best alignment with the ${answers.primaryAction} conversion goal and requested scope.`
            : "Strongest balance of the approved brand, renter information needs, and requested scope.",
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    );
}

export type GuidedJourneyProjection = {
  stage:
    | "conversation"
    | "assets"
    | "recommendation"
    | "build"
    | "progress"
    | "preview"
    | "launch";
  headline: string;
  explanation: string;
  recommendedAction: string;
  progress: ReturnType<typeof guidedDiscoveryProgress>;
  blocker: string | null;
  retryable: boolean;
  previewUrl: string | null;
};

export function projectGuidedJourney(
  state: GuidedJourneyState,
  runtime?: {
    generationStatus?: string | null;
    previewUrl?: string | null;
    productionUrl?: string | null;
  },
): GuidedJourneyProjection {
  const progress = guidedDiscoveryProgress(state.answers);
  const runtimeStatus = runtime?.generationStatus || "";
  if (
    runtime?.productionUrl ||
    ["deployed", "live", "production", "published"].includes(runtimeStatus)
  ) {
    return {
      stage: "launch",
      headline: "Your website is live",
      explanation:
        "Use the launch workspace to monitor production and recovery controls.",
      recommendedAction: "View launch status",
      progress,
      blocker: null,
      retryable: false,
      previewUrl: runtime?.productionUrl || runtime?.previewUrl || null,
    };
  }
  if (
    runtime?.previewUrl ||
    ["ready_for_preview", "complete", "succeeded"].includes(runtimeStatus)
  ) {
    return {
      stage: "preview",
      headline: "Your preview is ready",
      explanation:
        "Review the generated site and refine it conversationally before launch.",
      recommendedAction: "Open preview",
      progress,
      blocker: null,
      retryable: false,
      previewUrl: runtime?.previewUrl || null,
    };
  }
  if (state.lastError) {
    return {
      stage: state.prepared ? "build" : "conversation",
      headline:
        state.lastError.kind === "temporary"
          ? "SiteForge hit a temporary problem"
          : state.lastError.kind === "source_changed"
            ? "Property information changed"
            : "SiteForge needs your attention",
      explanation: state.lastError.message,
      recommendedAction: state.lastError.retryable
        ? "Try again"
        : "Review the highlighted information",
      progress,
      blocker: state.lastError.message,
      retryable: state.lastError.retryable,
      previewUrl: runtime?.previewUrl || null,
    };
  }
  if (state.generation) {
    const generationStatus =
      runtime?.generationStatus || state.generation.status;
    const launched =
      Boolean(runtime?.productionUrl) ||
      ["deployed", "live", "production", "published"].includes(
        generationStatus,
      );
    const ready = ["ready_for_preview", "complete", "succeeded"].includes(
      generationStatus,
    );
    return {
      stage: launched ? "launch" : ready ? "preview" : "progress",
      headline: launched
        ? "Your website is live"
        : ready
          ? "Your preview is ready"
          : "SiteForge is building your site",
      explanation: launched
        ? "Use the launch workspace to monitor production and recovery controls."
        : ready
          ? "Review the generated site and refine it conversationally before launch."
          : "The durable generation job will resume safely if you leave this page.",
      recommendedAction: launched
        ? "View launch status"
        : ready
          ? "Open preview"
          : "View progress",
      progress,
      blocker: null,
      retryable: false,
      previewUrl: runtime?.productionUrl || runtime?.previewUrl || null,
    };
  }
  if (state.prepared) {
    return {
      stage: "recommendation",
      headline: "Your site recommendation is ready",
      explanation:
        "SiteForge combined your answers with current property, brand, readiness, and asset truth.",
      recommendedAction: "Build this site",
      progress,
      blocker: null,
      retryable: false,
      previewUrl: null,
    };
  }
  if (progress.complete) {
    return {
      stage: "assets",
      headline: "Add photos and floor plans",
      explanation:
        "Use the dedicated visual intake, or continue without optional visuals.",
      recommendedAction: "Prepare recommendation",
      progress,
      blocker: null,
      retryable: false,
      previewUrl: null,
    };
  }
  return {
    stage: "conversation",
    headline: "Tell SiteForge what the site should accomplish",
    explanation:
      "SiteForge uses existing property and brand truth first, then asks only for missing decisions.",
    recommendedAction: "Answer the next question",
    progress,
    blocker: null,
    retryable: false,
    previewUrl: null,
  };
}

export class GuidedJourneyError extends Error {
  constructor(
    message: string,
    readonly kind: "temporary" | "source_changed" | "needs_attention",
    readonly retryable = false,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "GuidedJourneyError";
  }
}

export function classifyGuidedError(error: unknown): {
  kind: "temporary" | "source_changed" | "needs_attention";
  message: string;
  retryable: boolean;
  statusCode: number;
} {
  if (error instanceof GuidedJourneyError) {
    return {
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
      statusCode:
        error.kind === "source_changed"
          ? 409
          : error.kind === "temporary"
            ? 503
            : 400,
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (/stale|changed|reload|current source/i.test(message)) {
    return {
      kind: "source_changed",
      message:
        "Property or brand information changed. Prepare a fresh recommendation before building.",
      retryable: false,
      statusCode: 409,
    };
  }
  if (/timeout|temporar|unavailable|failed to start|provider/i.test(message)) {
    return {
      kind: "temporary",
      message:
        "SiteForge could not finish that step right now. Your work is saved.",
      retryable: true,
      statusCode: 503,
    };
  }
  return {
    kind: "needs_attention",
    message:
      "SiteForge needs a valid answer or completed prerequisite to continue.",
    retryable: false,
    statusCode: 400,
  };
}
