import { z } from "zod";
import type { PropertyVerticalProfile } from "@/utils/real-estate/contracts";
import { hashSiteForgeContent } from "@/utils/siteforge/content-hash";
import type { ComposedVerticalManifest } from "@/utils/siteforge/verticals/contracts";
import {
  guidedAnswersSchema,
  guidedDecisionAnswerRecordSchema,
  guidedDecisionDefinitionSchema,
  guidedJourneyStateV2Schema,
  siteStoryContractSchema,
  type GuidedAnswers,
  type GuidedDecisionAnswerRecord,
  type GuidedDecisionDefinition,
  type GuidedJourneyState,
  type GuidedJourneyStateV1,
  type GuidedQuestion,
  type SiteStoryContract,
  type SiteStoryDecision,
  type SiteStoryIdentity,
} from "./contracts";

export type AdaptiveEvidenceEntry = {
  id: string;
  kind: string;
  label: string;
  sourceType: string;
  sourceId: string;
  url: string | null;
  observedAt: string | null;
  freshUntil: string | null;
  content?: unknown;
};

export type AdaptiveVerticalContext = {
  profile: {
    id: string;
    version: number;
    contentHash: string;
    mappingStatus: "confirmed" | "needs_review";
    mappingReason: string | null;
    value: PropertyVerticalProfile;
  };
  manifest: ComposedVerticalManifest;
  evidence: {
    contextHash: string;
    entries: AdaptiveEvidenceEntry[];
  };
};

export type AdaptiveDiscoveryResolution = {
  decisions: GuidedDecisionDefinition[];
  decisionAnswers: Record<string, GuidedDecisionAnswerRecord>;
  answers: GuidedAnswers;
  decisionSetHash: string;
  answerHash: string;
  discoveryHash: string;
  unresolvedRequiredDecisionIds: string[];
  siteStory: SiteStoryContract;
  siteStoryIdentity: SiteStoryIdentity;
};

function title(value: string): string {
  return value
    .replace(/^siteforge\.vertical\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

const LOCKED_STORY_QUESTION_PATHS = [
  "goals",
  "objectives",
  "cta",
  "conversion",
  "pages",
  "scope.includedPages",
  "legal",
  "legalConstraints",
  "accessibility",
  "accessibilityRequirements",
  "analytics",
  "analyticsRecipe",
  "seo",
] as const;

export function eligibleSiteStoryQuestions(
  story: SiteStoryContract,
): SiteStoryDecision[] {
  const resolutionByDecision = new Map(
    story.resolutions.map((resolution) => [resolution.decisionId, resolution]),
  );
  return story.decisions.filter((decision) => {
    const resolution = resolutionByDecision.get(decision.id);
    if (resolution?.status !== "needs_confirmation") return false;
    if (decision.materiality === "low") return false;
    return !decision.affectedPaths.some((path) =>
      LOCKED_STORY_QUESTION_PATHS.some(
        (locked) => path === locked || path.startsWith(`${locked}.`),
      ),
    );
  });
}

function primaryIntent(manifest: ComposedVerticalManifest): string {
  const lifecycle = manifest.lifecycleOverrides.find(
    (item) => item.lifecycle === manifest.selection.lifecycle,
  )?.preferredConversionIntent;
  const modifierPrefix = "modifier.";
  const modifier = manifest.conversionIntentRecipes.find((recipe) =>
    manifest.selection.modifiers.some((item) =>
      recipe.id.startsWith(`${modifierPrefix}${item}.`),
    ),
  )?.intent;
  const archetype = manifest.conversionIntentRecipes.find((recipe) =>
    recipe.id.startsWith(`archetype.${manifest.selection.archetype}.`),
  )?.intent;
  return (
    modifier ||
    (manifest.selection.lifecycle === "operating" ? null : lifecycle) ||
    archetype ||
    lifecycle ||
    "inquiry"
  );
}

function storyLane(
  context: AdaptiveVerticalContext,
): SiteStoryContract["lane"] {
  return context.manifest.selection.transaction === "for_sale"
    ? "for_sale"
    : "multifamily";
}

export function synthesizeSiteStory(
  context: AdaptiveVerticalContext,
): { story: SiteStoryContract; identity: SiteStoryIdentity } {
  const lane = storyLane(context);
  const evidenceIds = context.evidence.entries
    .map((entry) => entry.id)
    .sort((left, right) => left.localeCompare(right));
  const confidence =
    context.profile.mappingStatus === "confirmed" ? 0.94 : 0.58;
  const intent = title(primaryIntent(context.manifest));
  const audienceLabel = context.profile.value.audiences[0] || "Primary visitors";
  const practicalNeeds = unique([
    ...context.profile.value.audiences.map(
      (audience) => `Information relevant to ${audience}`,
    ),
    ...context.manifest.offeringKinds.map(
      (kind) => `Clear, verified ${title(kind).toLowerCase()} information`,
    ),
  ]);
  const source = {
    type: "vertical_pack" as const,
    id: context.manifest.contentHash,
    path: "manifest",
  };
  const pageIntentValues =
    lane === "multifamily"
      ? [
          ["orient", "Understand the community promise", "Establish relevance and orientation"],
          ["evaluate_residences", "Compare available residences", "Turn inventory facts into confident evaluation"],
          ["evaluate_amenities", "Assess daily-life benefits", "Connect verified amenities to practical needs"],
          ["evaluate_location", "Understand the location", "Ground the location story in verified context"],
          ["convert", `Take the ${intent.toLowerCase()} next step`, "Resolve the journey with a clear next step"],
        ]
      : [
          ["orient", "Understand the builder or community promise", "Establish relevance and orientation"],
          ["evaluate_homes", "Compare homes and communities", "Turn verified home facts into confident evaluation"],
          ["evaluate_location", "Understand the location", "Ground the location story in verified context"],
          ["establish_trust", "Verify the buying proposition", "Build confidence with sourced proof"],
          ["convert", `Take the ${intent.toLowerCase()} next step`, "Resolve the journey with a clear next step"],
        ];
  const pageIntents = pageIntentValues.map(
    ([role, visitorJob, narrativeJob], index) => ({
      id: `story.page-intent.${lane}.${role}`,
      role,
      visitorJob,
      narrativeJob,
      desiredAction:
        role === "convert" ? intent : "Continue to the next decision",
      required: true,
      evidenceIds,
      affectedPaths: [`story.pageIntents.${index}`],
    }),
  );
  const lockedValues = {
    goals:
      context.manifest.analyticsOutcomes.find((outcome) => outcome.northStar)
        ?.outcome || "qualified_inquiry",
    cta: primaryIntent(context.manifest),
    pages: context.manifest.pages.map((page) => page.id),
    legal: context.manifest.policyCodes,
    accessibility: "WCAG 2.2 AA",
    analytics: context.manifest.analyticsOutcomes.map((item) => item.outcome),
    seo: context.manifest.seoSchemaTypes,
  };
  const lockedPaths = {
    goals: ["objectives"],
    cta: ["conversion"],
    pages: ["scope.includedPages"],
    legal: ["legalConstraints"],
    accessibility: ["accessibilityRequirements"],
    analytics: ["analyticsRecipe"],
    seo: ["seo"],
  };
  const decisions = [
    {
      id: "story.narrative.promise",
      topic: "narrative" as const,
      prompt: "Does the proposed site promise reflect the strongest verified story?",
      proposedValue: `Make ${context.profile.value.displayName} easy to understand and act on.`,
      source,
      evidenceIds,
      confidence,
      materiality: "critical" as const,
      affectedPaths: ["story.promise", "brief.summary", "plan.summary"],
    },
    {
      id: "story.audience.practical-needs",
      topic: "audience_need" as const,
      prompt: "Are these the practical visitor needs that should shape the story?",
      proposedValue: practicalNeeds,
      source,
      evidenceIds,
      confidence,
      materiality: "material" as const,
      affectedPaths: ["story.audience.practicalNeeds", "brief.audiences"],
    },
    {
      id: "story.journey.emphasis",
      topic: "journey_emphasis" as const,
      prompt: "Should another verified proof point lead the narrative arc?",
      proposedValue: context.manifest.offeringKinds.map(title),
      source,
      evidenceIds,
      confidence,
      materiality: "material" as const,
      affectedPaths: ["story.narrativeArc", "plan.brandDirection.mustInclude"],
    },
  ];
  const story = siteStoryContractSchema.parse({
    contractVersion: "3.0",
    id: `site-story.${lane}.${context.manifest.selection.archetype}`,
    lane,
    premise: `${context.profile.value.displayName} visitors need a source-grounded path from orientation to ${intent.toLowerCase()}.`,
    audience: {
      label: audienceLabel,
      practicalNeeds: practicalNeeds.length
        ? practicalNeeds
        : ["Clear, verified offering information"],
    },
    promise: decisions[0].proposedValue,
    narrativeArc: [
      `Orient visitors to ${context.profile.value.displayName}.`,
      `Build confidence with verified ${context.manifest.offeringKinds.map(title).join(" and ")} proof.`,
      `Resolve with a clear ${intent.toLowerCase()} path.`,
    ],
    pageIntents,
    lockedDefaults: Object.entries(lockedValues).map(([key, value]) => ({
      key,
      locked: true,
      value,
      source: {
        type: "locked_default",
        id: context.manifest.contentHash,
        path: `manifest.${key}`,
      },
      evidenceIds,
      confidence: 1,
      affectedPaths: lockedPaths[key as keyof typeof lockedPaths],
    })),
    decisions,
    resolutions: decisions.map((decision) => ({
      decisionId: decision.id,
      status: confidence < 0.8 ? "needs_confirmation" : "inferred",
      value: decision.proposedValue,
      source: decision.source,
      evidenceIds: decision.evidenceIds,
      confidence,
      materiality: decision.materiality,
      affectedPaths: decision.affectedPaths,
    })),
  });
  return {
    story,
    identity: {
      id: story.id,
      contractVersion: story.contractVersion,
      contentHash: hashSiteForgeContent(story),
    },
  };
}

function decisionValue(
  layer: string,
  selector: string,
  context: AdaptiveVerticalContext,
): unknown {
  switch (layer) {
    case "scope":
      return context.manifest.selection.scope;
    case "sector":
      return context.manifest.selection.sector;
    case "transaction":
      return primaryIntent(context.manifest);
    case "archetype":
      return context.manifest.pages.map((page) => page.id);
    case "modifier":
      return context.manifest.offeringKinds;
    case "lifecycle":
      return null;
    default:
      return selector;
  }
}

function decisionControl(layer: string) {
  if (layer === "modifier") return "multiselect" as const;
  if (layer === "archetype") return "ranking" as const;
  if (layer === "lifecycle") return "date" as const;
  return "enum" as const;
}

function optionsFor(
  layer: string,
  selector: string,
  context: AdaptiveVerticalContext,
) {
  if (layer === "transaction") {
    return unique(
      context.manifest.conversionIntentRecipes.map((recipe) => recipe.intent),
    ).map((value) => ({ value, label: title(value) }));
  }
  if (layer === "archetype") {
    return context.manifest.pages.map((page) => ({
      value: page.id,
      label: page.title,
    }));
  }
  if (layer === "modifier") {
    return context.manifest.offeringKinds.map((value) => ({
      value,
      label: title(value),
    }));
  }
  if (layer === "lifecycle") return [];
  return [{ value: selector, label: title(selector) }];
}

function evidenceForPack(
  layer: string,
  selector: string,
  context: AdaptiveVerticalContext,
) {
  const requirements = context.manifest.requiredEvidence.filter((item) =>
    item.id.startsWith(`${layer}.${selector}.`),
  );
  const kinds = new Set(requirements.map((item) => item.kind));
  return context.evidence.entries
    .filter((entry) => kinds.has(entry.kind as never))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildDecision(
  pack: ComposedVerticalManifest["packs"][number],
  decisionId: string,
  context: AdaptiveVerticalContext,
): {
  definition: GuidedDecisionDefinition;
  answer: GuidedDecisionAnswerRecord | null;
} {
  const control = decisionControl(pack.layer);
  const options = optionsFor(pack.layer, pack.selector, context);
  const evidence = evidenceForPack(pack.layer, pack.selector, context);
  const value = decisionValue(pack.layer, pack.selector, context);
  const required = ["scope", "sector", "transaction", "archetype"].includes(
    pack.layer,
  );
  const threshold = required ? 0.8 : 0.7;
  const baseConfidence =
    context.profile.mappingStatus === "confirmed" ? 0.96 : 0.55;
  const deterministicFromConfirmedProfile = [
    "core",
    "scope",
    "sector",
    "transaction",
    "archetype",
  ].includes(pack.layer);
  const confidence =
    evidence.length > 0 || deterministicFromConfirmedProfile
      ? baseConfidence
      : Math.min(baseConfidence, 0.72);
  const sourceLabels = unique([
    "current vertical profile",
    ...evidence.slice(0, 3).map((entry) => entry.label),
  ]);
  const hypothesisValue =
    value === null
      ? `${title(pack.selector)} timing has not been set`
      : Array.isArray(value)
        ? value.length
          ? value.map(String).map(title).join(", ")
          : "none"
        : title(String(value));
  const definition = guidedDecisionDefinitionSchema.parse({
    id: decisionId,
    packKey: pack.key,
    label:
      pack.layer === "transaction"
        ? "Primary conversion path"
        : pack.layer === "archetype"
          ? "Page priority"
          : pack.layer === "modifier"
            ? `${title(pack.selector)} offering types`
            : pack.layer === "lifecycle"
              ? "Target launch date"
              : `${title(pack.layer)} confirmation`,
    prompt:
      pack.layer === "lifecycle"
        ? "Choose a target launch date if timing should shape this recommendation."
        : `Confirm or revise the proposed ${title(pack.layer).toLowerCase()}.`,
    hypothesis: `Based on ${sourceLabels.join(", ")}, SiteForge proposes ${hypothesisValue}.`,
    provenanceLabel: `Suggested from ${sourceLabels.join(", ")}.`,
    control,
    answerSchema: {
      type:
        control === "multiselect" || control === "ranking"
          ? "array"
          : control === "date"
            ? "date"
            : "string",
      enum: options.map((option) => option.value),
      minItems: control === "ranking" && options.length ? 1 : undefined,
      maxItems:
        control === "multiselect" || control === "ranking"
          ? Math.max(1, options.length)
          : undefined,
    },
    options,
    when: [],
    requiredWhen: required
      ? [
          {
            path: "profile.mappingStatus",
            operator: "exists",
          },
        ]
      : [],
    required,
    inference: {
      strategy:
        pack.layer === "transaction" || pack.layer === "archetype"
          ? "pack_recipe"
          : "vertical_profile",
      sourcePath: `manifest.selection.${pack.layer}`,
    },
    confidenceThreshold: threshold,
    evidenceIds: evidence.map((entry) => entry.id),
    sensitivity:
      context.manifest.policyCodes.includes("health_data_minimization")
        ? "regulated"
        : "low",
    affectedPlanFields:
      pack.layer === "transaction"
        ? ["conversion.primaryAction", "analytics.outcomes"]
        : pack.layer === "archetype"
          ? ["scope.includedPages", "pages.order"]
          : pack.layer === "modifier"
            ? ["offerings.kinds", "content.constraints"]
            : pack.layer === "lifecycle"
              ? ["launchTarget.targetDate"]
              : [`vertical.${pack.layer}`],
    validation: {
      code: `guided.${pack.layer}.invalid`,
      message: `Choose a valid ${title(pack.layer).toLowerCase()} value from the composed vertical pack.`,
      remediation: "Review the sourced hypothesis and select one of the available values.",
    },
  });
  const answer =
    value === null
      ? null
      : guidedDecisionAnswerRecordSchema.parse({
          decisionId,
          value,
          origin: "inferred",
          confidence,
          evidenceIds: evidence.map((entry) => entry.id),
          actor: { type: "system", id: "siteforge.adaptive-discovery.v2" },
          confirmedAt: null,
        });
  return { definition, answer };
}

export function hashGuidedDecisionAnswers(
  answers: Record<string, GuidedDecisionAnswerRecord>,
): string {
  return hashSiteForgeContent(
    Object.fromEntries(
      Object.entries(answers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, answer]) => [
          id,
          {
            value: answer.value,
            origin: answer.origin,
            confidence: answer.confidence,
            evidenceIds: [...answer.evidenceIds].sort(),
            actor: answer.actor,
          },
        ]),
    ),
  );
}

export function compatibilityAnswersFromContext(
  context: AdaptiveVerticalContext,
): GuidedAnswers {
  const intent = primaryIntent(context.manifest);
  const action =
    intent === "tour" || intent === "visit" || intent === "private_appointment"
      ? "tours"
      : intent === "apply"
        ? "applications"
        : "contact";
  const pages = unique([
    "Home",
    ...context.manifest.pages
      .filter((page) => page.required)
      .map((page) => page.title),
  ]);
  const needs = unique([
    ...context.profile.value.audiences.map(title),
    ...context.manifest.offeringKinds.map(
      (kind) => `Verified ${title(kind).toLowerCase()} information`,
    ),
  ]);
  const outcome =
    context.manifest.analyticsOutcomes.find((item) => item.northStar)?.outcome ||
    "qualified_inquiry";
  return guidedAnswersSchema.parse({
    objective: `Support ${title(intent).toLowerCase()} for ${context.profile.value.displayName}`,
    successSignal: title(outcome),
    renterNeeds: needs.length ? needs : ["Verified offering and contact information"],
    primaryAction: action,
    pageScope: { included: pages, excluded: [] },
    differentiators: [
      context.profile.value.displayName,
      ...context.manifest.selection.modifiers.map(title),
    ],
    offers: [],
    deadline: { date: null, flexibility: "flexible" },
    references: context.evidence.entries
      .filter((entry) => entry.url)
      .map((entry) => ({
        label: entry.label,
        url: entry.url || undefined,
        sourceId: entry.sourceId,
      }))
      .slice(0, 30),
    constraints: context.manifest.policyCodes.map(
      (code) => `Comply with ${title(code)}`,
    ),
  });
}

export function applyAdaptiveAnswersToCompatibility(
  base: GuidedAnswers,
  decisions: GuidedDecisionDefinition[],
  answers: Record<string, GuidedDecisionAnswerRecord>,
): GuidedAnswers {
  const next = { ...base };
  for (const decision of decisions) {
    const answer = answers[decision.id];
    if (!answer) continue;
    if (
      decision.id.startsWith("legacy.v1.") &&
      decision.inference.sourcePath.startsWith("answers.")
    ) {
      if (answer.origin === "legacy_adapter") {
        const field = decision.inference.sourcePath.replace("answers.", "");
        (next as Record<string, unknown>)[field] = answer.value;
      }
      continue;
    }
    if (decision.affectedPlanFields.includes("conversion.primaryAction")) {
      const value = String(answer.value);
      next.primaryAction =
        value === "tour" ||
        value === "visit" ||
        value === "private_appointment"
          ? "tours"
          : value === "apply"
            ? "applications"
            : "contact";
    }
    if (
      decision.control === "ranking" &&
      Array.isArray(answer.value) &&
      answer.value.length
    ) {
      const labels = new Map(
        decision.options.map((option) => [option.value, option.label]),
      );
      next.pageScope = {
        included: unique([
          "Home",
          ...answer.value.map((value) => labels.get(String(value)) || String(value)),
        ]),
        excluded: next.pageScope?.excluded || [],
      };
    }
    if (decision.control === "date" && typeof answer.value === "string") {
      next.deadline = { date: answer.value, flexibility: "target" };
    }
  }
  return guidedAnswersSchema.parse(next);
}

export function resolveAdaptiveDiscovery(
  context: AdaptiveVerticalContext,
): AdaptiveDiscoveryResolution {
  const decisions: GuidedDecisionDefinition[] = [];
  const decisionAnswers: Record<string, GuidedDecisionAnswerRecord> = {};
  for (const pack of context.manifest.packs) {
    const decisionId =
      context.manifest.decisionIds.find((id) =>
        id.startsWith(`${pack.layer}.${pack.selector}.`),
      ) || `${pack.layer}.${pack.selector}.decision.confirm`;
    const { definition, answer } = buildDecision(pack, decisionId, context);
    decisions.push(definition);
    if (answer) decisionAnswers[decisionId] = answer;
  }
  const decisionSetHash = hashSiteForgeContent(decisions);
  const answerHash = hashGuidedDecisionAnswers(decisionAnswers);
  const unresolvedRequiredDecisionIds = decisions
    .filter((decision) => {
      if (!decision.required) return false;
      const answer = decisionAnswers[decision.id];
      return !answer || answer.confidence < decision.confidenceThreshold;
    })
    .slice(0, 4)
    .map((decision) => decision.id);
  const siteStory = synthesizeSiteStory(context);
  return {
    decisions,
    decisionAnswers,
    answers: compatibilityAnswersFromContext(context),
    decisionSetHash,
    answerHash,
    discoveryHash: hashSiteForgeContent({
      profile: context.profile.contentHash,
      pack: context.manifest.contentHash,
      evidence: context.evidence.contextHash,
      decisionSetHash,
      answerHash,
    }),
    unresolvedRequiredDecisionIds,
    siteStory: siteStory.story,
    siteStoryIdentity: siteStory.identity,
  };
}

export function adaptiveDiscoveryProgress(state: GuidedJourneyState) {
  const required = state.decisions.filter((decision) => decision.required);
  const resolved = required.filter((decision) => {
    const answer = state.decisionAnswers[decision.id];
    return Boolean(answer && answer.confidence >= decision.confidenceThreshold);
  });
  const requiredComplete = resolved.length === required.length;
  return {
    answered: resolved.length,
    total: required.length,
    percent: required.length
      ? Math.round((resolved.length / required.length) * 100)
      : 100,
    requiredComplete,
    complete: requiredComplete,
  };
}

export function questionForDecision(
  decision: GuidedDecisionDefinition,
  answer: GuidedDecisionAnswerRecord | null,
): GuidedQuestion {
  return {
    ...decision,
    field: decision.id,
    question: `${decision.hypothesis} ${decision.prompt}`,
    why: decision.validation.remediation,
    optional: !decision.required,
    currentAnswer: answer,
  };
}

export function nextAdaptiveQuestion(
  state: Pick<GuidedJourneyState, "decisions" | "decisionAnswers">,
): GuidedQuestion | null {
  const decision = state.decisions.find((item) => {
    if (!item.required) return false;
    const answer = state.decisionAnswers[item.id];
    return !answer || answer.confidence < item.confidenceThreshold;
  });
  return decision
    ? questionForDecision(decision, state.decisionAnswers[decision.id] || null)
    : null;
}

export function validateAdaptiveDecisionAnswer(
  decision: GuidedDecisionDefinition,
  value: unknown,
): unknown {
  let schema: z.ZodType;
  if (decision.answerSchema.type === "array") {
    const item = decision.answerSchema.enum.length
      ? z.enum(decision.answerSchema.enum as [string, ...string[]])
      : z.string().trim().min(1).max(240);
    schema = z
      .array(item)
      .min(decision.answerSchema.minItems || 0)
      .max(decision.answerSchema.maxItems || 50);
  } else if (decision.answerSchema.type === "date") {
    schema = z.string().date();
  } else {
    schema = decision.answerSchema.enum.length
      ? z.enum(decision.answerSchema.enum as [string, ...string[]])
      : z.string().trim().min(1).max(2_000);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${decision.validation.message} ${decision.validation.remediation}`,
    );
  }
  return parsed.data;
}

function legacyDefinitions(
  state: GuidedJourneyStateV1,
): GuidedDecisionDefinition[] {
  return Object.keys(state.answers).map((field) =>
      guidedDecisionDefinitionSchema.parse({
        id: `legacy.v1.${field.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`,
        packKey: "siteforge.guided.legacy.v1",
        label: title(field),
        prompt: "Preserved from the V1 guided journey.",
        hypothesis: "This answer was provided in the previous guided journey.",
        provenanceLabel: "Migrated deterministically from GuidedJourneyState V1.",
        control: "text",
        answerSchema: { type: "string", enum: [] },
        options: [],
        when: [],
        requiredWhen: [],
        required: false,
        inference: {
          strategy: "legacy_adapter",
          sourcePath: `answers.${field}`,
        },
        confidenceThreshold: 0,
        evidenceIds: [],
        sensitivity: "low",
        affectedPlanFields: [`legacy.${field}`],
        validation: {
          code: "guided.legacy.preserved",
          message: "Legacy answer is preserved as data.",
          remediation: "Use the adaptive decisions for future revisions.",
        },
      }),
    );
}

export function adaptGuidedJourneyV1(
  state: GuidedJourneyStateV1,
  context: AdaptiveVerticalContext,
): GuidedJourneyState {
  const adaptive = resolveAdaptiveDiscovery(context);
  const legacyDecisions = legacyDefinitions(state);
  const legacyAnswers = Object.fromEntries(
    legacyDecisions.flatMap((decision) => {
      const field = decision.inference.sourcePath.replace("answers.", "");
      const value = state.answers[field as keyof GuidedAnswers];
      if (value === null) return [];
      return [
        [
          decision.id,
          guidedDecisionAnswerRecordSchema.parse({
            decisionId: decision.id,
            value,
            origin: "legacy_adapter",
            confidence: 1,
            evidenceIds: [],
            actor: { type: "system", id: "siteforge.guided.v1-to-v2" },
            confirmedAt: null,
          }),
        ] as const,
      ];
    }),
  );
  const decisions = [...legacyDecisions, ...adaptive.decisions];
  const decisionAnswers = { ...legacyAnswers, ...adaptive.decisionAnswers };
  const decisionSetHash = hashSiteForgeContent(decisions);
  const answerHash = hashGuidedDecisionAnswers(decisionAnswers);
  const discoveryHash = hashSiteForgeContent({
    profile: context.profile.contentHash,
    pack: context.manifest.contentHash,
    evidence: context.evidence.contextHash,
    decisionSetHash,
    answerHash,
  });
  return guidedJourneyStateV2Schema.parse({
    ...state,
    schemaVersion: 2,
    status: adaptive.unresolvedRequiredDecisionIds.length
      ? "discovering"
      : state.prepared
        ? "ready_to_build"
        : "ready_to_prepare",
    answers: state.answers,
    decisions,
    decisionAnswers,
    decisionSetHash,
    answerHash,
    discoveryHash,
    turns: state.turns.map((turn) => ({
      ...turn,
      field: turn.field ? `legacy.v1.${turn.field}` : null,
    })),
    sources: {
      ...state.sources,
      verticalProfile: {
        id: context.profile.id,
        version: context.profile.version,
        contentHash: context.profile.contentHash,
      },
      verticalPack: {
        registryVersion: context.manifest.registryVersion,
        contentHash: context.manifest.contentHash,
        packs: context.manifest.packs.map((pack) => ({
          key: pack.key,
          version: pack.version,
          contentHash: pack.contentHash,
        })),
      },
      evidence: context.evidence,
    },
    preparation: state.preparation,
    prepared: state.prepared
      ? {
          ...state.prepared,
          verticalProfileContentHash: context.profile.contentHash,
          verticalPackContentHash: context.manifest.contentHash,
          decisionSetHash,
          answerHash,
          discoveryHash,
        }
      : null,
    generation: state.generation,
  });
}
