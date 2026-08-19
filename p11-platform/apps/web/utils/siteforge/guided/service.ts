import type { Json } from "@/types/supabase";
import { createServiceClient } from "@/utils/supabase/admin";
import {
  approveOnboardingSnapshot,
  buildOnboardingSnapshot,
} from "@/utils/onboarding/repository";
import {
  createSiteForgeBriefVersion,
  getSiteForgeBrief,
  listSiteForgeBriefVersions,
  loadCurrentBriefSources,
  saveCurrentSiteForgeBrief,
} from "@/utils/siteforge/briefs/repository";
import { hashSiteForgeBrief } from "@/utils/siteforge/briefs/contracts";
import {
  confirmSiteForgeCreativeDirectionSelection,
  createSiteForgeDirectionSet,
  getSiteForgeDirectionSet,
  selectSiteForgeCreativeDirection,
  SiteForgeDirectionError,
} from "@/utils/siteforge/directions/repository";
import {
  editSiteForgeCreativeDirection,
  selectSiteForgeCreativeDirectionAlternative,
} from "@/utils/siteforge/directions/editor-service";
import {
  createPlanRevision,
  decideSiteForgePlan,
  getCurrentPlanRevision,
} from "@/utils/siteforge/plans/repository";
import { hashSiteForgeContent } from "@/utils/siteforge/content-hash";
import { classifySiteForgeGenerationFailure } from "@/utils/siteforge/workflows/generation-failure";
import { loadAdaptiveVerticalContext } from "@/utils/real-estate/repository";
import {
  guidedJourneyStateV1Schema,
  guidedJourneyStateV2Schema,
  type GuidedAttachment,
  type GuidedCreativeDirectionOverview,
  type GuidedJourneyState,
} from "./contracts";
import {
  buildAdaptiveGuidedBrief,
  classifyGuidedError,
  projectGuidedJourney,
  scoreGuidedDirections,
  updateGuidedAnswers,
  GuidedJourneyError,
} from "./journey";
import {
  adaptGuidedJourneyV1,
  adaptiveDiscoveryProgress,
  applyAdaptiveAnswersToCompatibility,
  hashGuidedDecisionAnswers,
  nextAdaptiveQuestion,
  resolveAdaptiveDiscovery,
  synthesizeSiteStory,
  validateAdaptiveDecisionAnswer,
  type AdaptiveVerticalContext,
} from "./adaptive-discovery";
import { resolveVerticalActivation } from "@/utils/siteforge/verticals/activation";
import type { BrandForgeContractV1 } from "@/utils/brandforge/contracts";
import { normalizeBrandAssetRow } from "@/utils/brandforge/normalize";

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadGuidedBrandPresentation(
  state: GuidedJourneyState,
  client: ServiceClient,
): Promise<GuidedCreativeDirectionOverview["brandPresentation"]> {
  const { data: brandRow, error: brandError } = await client
    .from("property_brand_assets")
    .select("*")
    .eq("id", state.sources.brandAssetId)
    .eq("property_id", state.propertyId)
    .maybeSingle();
  if (brandError || !brandRow) return null;

  let contract: BrandForgeContractV1;
  try {
    contract = normalizeBrandAssetRow(
      brandRow as unknown as Record<string, unknown>,
    );
  } catch {
    return null;
  }
  const preferredLogo =
    contract.logos.variants.find(logo => logo.role === "primary") ||
    contract.logos.variants.find(logo => logo.role === "secondary") ||
    contract.logos.variants.find(logo => logo.role === "mark") ||
    null;
  let logoUrl = preferredLogo?.url || null;
  let logoAlt = preferredLogo?.alt || `${contract.identity.name} logo`;
  if (!logoUrl && preferredLogo?.assetId) {
    const { data: logoAsset } = await client
      .from("content_assets")
      .select("file_url, alt_text")
      .eq("id", preferredLogo.assetId)
      .eq("property_id", state.propertyId)
      .eq("org_id", state.orgId)
      .eq("approval_status", "approved")
      .maybeSingle();
    logoUrl = logoAsset?.file_url || null;
    logoAlt = logoAsset?.alt_text || logoAlt;
  }

  return {
    name: contract.identity.name,
    logo:
      preferredLogo && logoUrl
        ? {
            url: logoUrl,
            alt: logoAlt,
            role: preferredLogo.role,
          }
        : null,
    palette: contract.colors.roles.map(color => ({
      role: color.role,
      name: color.name,
      hex: color.hex.toUpperCase(),
      usage: color.usage,
    })),
    usageGuidelines: contract.colors.usageGuidelines,
  };
}

type GenerationStart = (input: {
  websiteId: string;
  planId: string;
  confirmedRevision: number;
  contentHash: string;
  idempotencyKey: string;
}) => Promise<{
  jobId: string;
  status: string;
  workflowRunId?: string | null;
  duplicate?: boolean;
}>;

type GuidedDependencies = {
  client: ServiceClient;
  now: () => Date;
  buildReadiness: typeof buildOnboardingSnapshot;
  approveReadiness: typeof approveOnboardingSnapshot;
  loadSources: typeof loadCurrentBriefSources;
  listBriefs: typeof listSiteForgeBriefVersions;
  saveBrief: typeof saveCurrentSiteForgeBrief;
  createBrief: typeof createSiteForgeBriefVersion;
  getBrief: typeof getSiteForgeBrief;
  createDirections: typeof createSiteForgeDirectionSet;
  getDirections: typeof getSiteForgeDirectionSet;
  selectDirection: typeof selectSiteForgeCreativeDirection;
  confirmDirection: typeof confirmSiteForgeCreativeDirectionSelection;
  createPlan: typeof createPlanRevision;
  getPlan: typeof getCurrentPlanRevision;
  decidePlan: typeof decideSiteForgePlan;
  editDirection: typeof editSiteForgeCreativeDirection;
  selectDirectionAlternative: typeof selectSiteForgeCreativeDirectionAlternative;
  loadAdaptiveContext: typeof loadAdaptiveVerticalContext;
  loadBrandPresentation: typeof loadGuidedBrandPresentation;
};

const defaultDependencies = (): GuidedDependencies => ({
  client: createServiceClient(),
  now: () => new Date(),
  buildReadiness: buildOnboardingSnapshot,
  approveReadiness: approveOnboardingSnapshot,
  loadSources: loadCurrentBriefSources,
  listBriefs: listSiteForgeBriefVersions,
  saveBrief: saveCurrentSiteForgeBrief,
  createBrief: createSiteForgeBriefVersion,
  getBrief: getSiteForgeBrief,
  createDirections: createSiteForgeDirectionSet,
  getDirections: getSiteForgeDirectionSet,
  selectDirection: selectSiteForgeCreativeDirection,
  confirmDirection: confirmSiteForgeCreativeDirectionSelection,
  createPlan: createPlanRevision,
  getPlan: getCurrentPlanRevision,
  decidePlan: decideSiteForgePlan,
  editDirection: editSiteForgeCreativeDirection,
  selectDirectionAlternative: selectSiteForgeCreativeDirectionAlternative,
  loadAdaptiveContext: loadAdaptiveVerticalContext,
  loadBrandPresentation: loadGuidedBrandPresentation,
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function sameSources(
  left: GuidedJourneyState["sources"],
  right: GuidedJourneyState["sources"],
): boolean {
  return (
    left.onboardingSnapshotId === right.onboardingSnapshotId &&
    left.onboardingSnapshotHash === right.onboardingSnapshotHash &&
    left.brandAssetId === right.brandAssetId &&
    left.brandContractHash === right.brandContractHash &&
    left.verticalProfile.contentHash === right.verticalProfile.contentHash &&
    left.verticalPack.contentHash === right.verticalPack.contentHash &&
    left.evidence.contextHash === right.evidence.contextHash
  );
}

function adaptiveSources(
  base: Pick<
    GuidedJourneyState["sources"],
    | "onboardingSnapshotId"
    | "onboardingSnapshotHash"
    | "brandAssetId"
    | "brandContractHash"
  >,
  context: AdaptiveVerticalContext,
): GuidedJourneyState["sources"] {
  return {
    ...base,
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
  };
}

function reconcileAdaptiveState(
  state: GuidedJourneyState,
  context: AdaptiveVerticalContext,
  baseSources = state.sources,
): GuidedJourneyState {
  const resolved = resolveAdaptiveDiscovery(context);
  const retained = Object.fromEntries(
    Object.entries(state.decisionAnswers).filter(([id, answer]) => {
      if (!["operator", "legacy_adapter"].includes(answer.origin)) return false;
      return (
        id.startsWith("legacy.v1.") ||
        resolved.decisions.some((decision) => decision.id === id)
      );
    }),
  );
  const decisions = [
    ...state.decisions.filter((decision) =>
      decision.id.startsWith("legacy.v1."),
    ),
    ...resolved.decisions,
  ];
  const decisionAnswers = {
    ...resolved.decisionAnswers,
    ...retained,
  };
  const decisionSetHash = hashSiteForgeContent(decisions);
  const answerHash = hashGuidedDecisionAnswers(decisionAnswers);
  const sources = adaptiveSources(baseSources, context);
  const discoveryHash = hashSiteForgeContent({
    profile: context.profile.contentHash,
    pack: context.manifest.contentHash,
    evidence: context.evidence.contextHash,
    decisionSetHash,
    answerHash,
  });
  const sourceChanged = !sameSources(state.sources, sources);
  const identityChanged =
    state.decisionSetHash !== decisionSetHash ||
    state.answerHash !== answerHash ||
    state.discoveryHash !== discoveryHash;
  const answers = applyAdaptiveAnswersToCompatibility(
    state.answers,
    decisions,
    decisionAnswers,
  );
  const provisional = guidedJourneyStateV2Schema.parse({
    ...state,
    answers,
    decisions,
    decisionAnswers,
    decisionSetHash,
    answerHash,
    discoveryHash,
    sources,
    ...(state.generation || (!sourceChanged && !identityChanged)
      ? {}
      : {
          preparation: null,
          prepared: null,
          status: "discovering",
        }),
  });
  return {
    ...provisional,
    status: provisional.generation
      ? provisional.status
      : provisional.prepared
        ? "ready_to_build"
        : adaptiveDiscoveryProgress(provisional).complete
          ? "ready_to_prepare"
          : "discovering",
  };
}

function attachmentReference(attachment: GuidedAttachment) {
  return {
    label: attachment.name,
    url: attachment.url,
    sourceId: attachment.sourceId,
    notes:
      attachment.kind === "document"
        ? `Attached document${attachment.mediaType ? ` (${attachment.mediaType})` : ""}`
        : "Attached reference",
  };
}

function visualRoute(attachment: GuidedAttachment) {
  return {
    attachment,
    route:
      attachment.kind === "floor_plan"
        ? "/api/siteforge/floor-plans/import/preview"
        : "/api/siteforge/assets",
    reason:
      "Visual files use the dedicated rights, curation, analysis, and floor-plan intake.",
  };
}

export class SiteForgeGuidedError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly kind: "temporary" | "source_changed" | "needs_attention",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SiteForgeGuidedError";
  }
}

export function toSiteForgeGuidedError(error: unknown): SiteForgeGuidedError {
  if (error instanceof SiteForgeGuidedError) return error;
  if (error instanceof SiteForgeDirectionError) {
    return new SiteForgeGuidedError(
      error.message,
      error.statusCode,
      error.statusCode === 409
        ? "source_changed"
        : error.statusCode >= 500
          ? "temporary"
          : "needs_attention",
      error.statusCode >= 500,
    );
  }
  const classified = classifyGuidedError(error);
  return new SiteForgeGuidedError(
    classified.message,
    classified.statusCode,
    classified.kind,
    classified.retryable,
  );
}

export function createSiteForgeGuidedService(
  dependencies: GuidedDependencies = defaultDependencies(),
) {
  const deps = dependencies;

  async function loadWebsite(websiteId: string) {
    const { data, error } = await deps.client
      .from("property_websites")
      .select(
        "id, property_id, org_id, generation_status, canonical_preview_url, staging_url, production_url",
      )
      .eq("id", websiteId)
      .single();
    if (error || !data?.org_id) {
      throw new SiteForgeGuidedError(
        "SiteForge website not found",
        404,
        "needs_attention",
        false,
      );
    }
    return data;
  }

  async function loadLatestState(
    websiteId: string,
    propertyId: string,
  ): Promise<GuidedJourneyState | null> {
    const { data, error } = await deps.client
      .from("shared_context_snapshots")
      .select("context_payload")
      .eq("property_id", propertyId)
      .eq("source_domain", "siteforge.guided")
      .like("source_ref", `website:${websiteId}:revision:%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new GuidedJourneyError(
        "SiteForge could not load the saved conversation.",
        "temporary",
        true,
      );
    }
    if (!data) return null;
    const parsedV2 = guidedJourneyStateV2Schema.safeParse(data.context_payload);
    if (parsedV2.success) return parsedV2.data;
    const parsedV1 = guidedJourneyStateV1Schema.safeParse(data.context_payload);
    if (!parsedV1.success) {
      throw new GuidedJourneyError(
        "The saved guided session needs attention before it can resume.",
        "needs_attention",
      );
    }
    const context = await deps.loadAdaptiveContext(
      {
        orgId: parsedV1.data.orgId,
        propertyId: parsedV1.data.propertyId,
      },
      deps.client,
    );
    const adapted = adaptGuidedJourneyV1(parsedV1.data, context);
    return persistState({
      ...adapted,
      revision: parsedV1.data.revision + 1,
      updatedAt: deps.now().toISOString(),
    });
  }

  async function loadLatestGenerationJob(input: {
    websiteId: string;
    propertyId: string;
    orgId: string;
  }) {
    const { data, error } = await deps.client
      .from("shared_jobs")
      .select(
        "id, subject_id, lifecycle_status, error_message, error_details, payload, created_at",
      )
      .eq("org_id", input.orgId)
      .eq("property_id", input.propertyId)
      .eq("domain", "siteforge.generation")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      throw new GuidedJourneyError(
        "SiteForge could not load the latest build status.",
        "temporary",
        true,
      );
    }
    return (data || []).find((job) => {
      const payload = record(job.payload);
      return (
        job.subject_id === input.websiteId ||
        payload.websiteId === input.websiteId
      );
    }) || null;
  }

  async function persistState(
    state: GuidedJourneyState,
  ): Promise<GuidedJourneyState> {
    const parsed = guidedJourneyStateV2Schema.parse(state);
    const contextHash = hashSiteForgeContent(parsed);
    const { data: duplicate } = await deps.client
      .from("shared_context_snapshots")
      .select("id")
      .eq("org_id", parsed.orgId)
      .eq("property_id", parsed.propertyId)
      .eq("source_domain", "siteforge.guided")
      .eq("context_hash", contextHash)
      .maybeSingle();
    if (duplicate) return parsed;
    const { error } = await deps.client
      .from("shared_context_snapshots")
      .insert({
        org_id: parsed.orgId,
        property_id: parsed.propertyId,
        source_domain: "siteforge.guided",
        source_ref: `website:${parsed.websiteId}:revision:${parsed.revision}`,
        context_hash: contextHash,
        context_payload: parsed as unknown as Json,
        captured_by: "siteforge-guided",
      });
    if (error) {
      if (error.code === "23505") {
        const latest = await loadLatestState(
          parsed.websiteId,
          parsed.propertyId,
        );
        if (
          latest &&
          (parsed.revision === 0 ||
            hashSiteForgeContent(latest) === contextHash)
        ) {
          return latest;
        }
        throw new GuidedJourneyError(
          "This conversation changed in another tab. Reload the latest step before continuing.",
          "source_changed",
          false,
        );
      }
      throw new GuidedJourneyError(
        "SiteForge could not save this step. Your previous answers are still available.",
        "temporary",
        true,
      );
    }
    return parsed;
  }

  async function createInitialState(
    websiteId: string,
  ): Promise<GuidedJourneyState> {
    const website = await loadWebsite(websiteId);
    const sources = await deps.loadSources(
      { orgId: website.org_id, propertyId: website.property_id },
      deps.client,
    );
    const [
      { data: onboarding },
      { data: brandRow },
      { data: property },
      context,
    ] =
      await Promise.all([
        deps.client
          .from("property_onboarding_snapshots")
          .select("snapshot_payload")
          .eq("id", sources.onboardingSnapshotId)
          .eq("property_id", website.property_id)
          .eq("org_id", website.org_id)
          .single(),
        deps.client
          .from("property_brand_assets")
          .select("*")
          .eq("id", sources.brandAssetId)
          .eq("property_id", website.property_id)
          .single(),
        deps.client
          .from("properties")
          .select("name")
          .eq("id", website.property_id)
          .eq("org_id", website.org_id)
          .single(),
        deps.loadAdaptiveContext(
          { orgId: website.org_id, propertyId: website.property_id },
          deps.client,
        ),
      ]);
    if (!onboarding || !brandRow || !property?.name) {
      throw new SiteForgeGuidedError(
        "Complete and approve property readiness before starting SiteForge.",
        409,
        "needs_attention",
        false,
      );
    }
    const discovery = resolveAdaptiveDiscovery(context);
    const now = deps.now().toISOString();
    const baseState = {
      schemaVersion: 2 as const,
      websiteId,
      propertyId: website.property_id,
      orgId: website.org_id,
      propertyName: property.name,
      revision: 0,
      status: discovery.unresolvedRequiredDecisionIds.length
        ? ("discovering" as const)
        : ("ready_to_prepare" as const),
      answers: discovery.answers,
      decisions: discovery.decisions,
      decisionAnswers: discovery.decisionAnswers,
      decisionSetHash: discovery.decisionSetHash,
      answerHash: discovery.answerHash,
      discoveryHash: discovery.discoveryHash,
      turns: [],
      attachments: [],
      sources: adaptiveSources(sources, context),
      preparation: null,
      prepared: null,
      generation: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    const firstQuestion = nextAdaptiveQuestion(baseState);
    const state = guidedJourneyStateV2Schema.parse({
      ...baseState,
      turns: firstQuestion
        ? [
            {
              id: "welcome:assistant",
              clientRequestId: "welcome",
              role: "assistant",
              field: firstQuestion.field,
              content: firstQuestion.question,
              createdAt: now,
            },
          ]
        : [
            {
              id: "welcome:assistant",
              clientRequestId: "welcome",
              role: "assistant",
              field: null,
              content:
                "I found enough sourced vertical, offering, policy, brand, and lifecycle evidence to prepare a recommendation. You can still revise any proposed decision.",
              createdAt: now,
            },
          ],
    });
    return persistState(state);
  }

  async function loadOrCreate(websiteId: string) {
    const website = await loadWebsite(websiteId);
    return (
      (await loadLatestState(websiteId, website.property_id)) ||
      createInitialState(websiteId)
    );
  }

  async function snapshot(websiteId: string) {
    const [loadedState, website] = await Promise.all([
      loadOrCreate(websiteId),
      loadWebsite(websiteId),
    ]);
    let state = loadedState;
    const currentContext = await deps.loadAdaptiveContext(
      { orgId: state.orgId, propertyId: state.propertyId },
      deps.client,
    );
    const reconciled = reconcileAdaptiveState(state, currentContext);
    if (
      reconciled.discoveryHash !== state.discoveryHash ||
      !sameSources(reconciled.sources, state.sources) ||
      reconciled.schemaVersion !== state.schemaVersion
    ) {
      state = await persistState({
        ...reconciled,
        revision: state.revision + 1,
        updatedAt: deps.now().toISOString(),
      });
    } else {
      state = reconciled;
    }
    const latestGeneration = await loadLatestGenerationJob({
      websiteId,
      propertyId: website.property_id,
      orgId: website.org_id,
    });
    const failure = record(latestGeneration?.error_details);
    const diagnostics = record(failure.diagnostics);
    const projectedFailure =
      latestGeneration?.lifecycle_status === "failed" &&
      (typeof failure.safeMessage !== "string" ||
        failure.code === "generation_failure")
        ? classifySiteForgeGenerationFailure(
            (typeof diagnostics.message === "string"
              ? diagnostics.message
              : latestGeneration.error_message) ||
              "SiteForge generation failed",
            "Generation failed",
          )
        : null;
    const question = nextAdaptiveQuestion(state);
    const [preparedDirections, brandPresentation] = state.prepared
      ? await Promise.all([
          deps.getDirections(
            state.prepared.directionSetId,
            state.propertyId,
            deps.client,
          ),
          deps.loadBrandPresentation(state, deps.client),
        ])
      : [null, null];
    const selectedDirection = preparedDirections?.directions.find(
      (direction) => direction.id === preparedDirections.selectedDirectionId,
    );
    return {
      state,
      question,
      creativeDirection:
        state.prepared && preparedDirections && selectedDirection
          ? {
              directionSetId: preparedDirections.id,
              directionSetContentHash: preparedDirections.contentHash,
              selected: selectedDirection,
              alternatives: preparedDirections.directions.filter(
                (direction) => direction.id !== selectedDirection.id,
              ),
              recommendationReason: state.prepared.recommendationReason,
              brandPresentation,
            }
          : null,
      journey: projectGuidedJourney(state, {
        generationStatus:
          latestGeneration?.lifecycle_status || website.generation_status,
        generationFailureReason:
          typeof failure.safeMessage === "string"
            ? projectedFailure?.safeMessage || failure.safeMessage
            : projectedFailure?.safeMessage,
        generationRetryable:
          failure.retryable === true || projectedFailure?.retryable === true,
        failedCheckpoint:
          typeof failure.failedCheckpoint === "string"
            ? failure.failedCheckpoint
            : projectedFailure?.failedCheckpoint || null,
        previewUrl: website.canonical_preview_url || website.staging_url,
        productionUrl: website.production_url,
      }),
      attachmentRoutes: {
        images: "/api/siteforge/assets",
        floorPlans: "/api/siteforge/floor-plans/import/preview",
      },
    };
  }

  async function conversation(
    websiteId: string,
    input: {
      clientRequestId: string;
      expectedRevision: number;
      decisionId?: string;
      field?: string;
      answer: unknown;
      attachments: GuidedAttachment[];
    },
    userId = "unknown-user",
  ) {
    let state = await loadOrCreate(websiteId);
    const currentContext = await deps.loadAdaptiveContext(
      { orgId: state.orgId, propertyId: state.propertyId },
      deps.client,
    );
    const reconciled = reconcileAdaptiveState(state, currentContext);
    if (reconciled.discoveryHash !== state.discoveryHash) {
      state = await persistState({
        ...reconciled,
        revision: state.revision + 1,
        updatedAt: deps.now().toISOString(),
      });
    }
    if (
      state.turns.some(
        (turn) =>
          turn.role === "user" &&
          turn.clientRequestId === input.clientRequestId,
      )
    ) {
      return {
        ...(await snapshot(websiteId)),
        duplicate: true,
        routedAttachments: [],
      };
    }
    if (state.generation) {
      throw new SiteForgeGuidedError(
        "Discovery decisions cannot change after the build has started.",
        409,
        "needs_attention",
        false,
      );
    }
    if (input.expectedRevision !== state.revision) {
      throw new SiteForgeGuidedError(
        "This conversation changed in another tab. Reload the latest question before answering.",
        409,
        "source_changed",
        false,
      );
    }
    const documentIds = input.attachments.flatMap((attachment) =>
      attachment.kind === "document" && attachment.sourceId
        ? [attachment.sourceId]
        : [],
    );
    if (documentIds.length) {
      const { data: documents, error } = await deps.client
        .from("documents")
        .select("id")
        .eq("property_id", state.propertyId)
        .in("id", documentIds);
      if (
        error ||
        new Set((documents || []).map((document) => document.id)).size !==
          new Set(documentIds).size
      ) {
        throw new SiteForgeGuidedError(
          "One or more attached documents are unavailable for this property.",
          400,
          "needs_attention",
          false,
        );
      }
    }
    const currentQuestion = nextAdaptiveQuestion(state);
    const requestedId = input.decisionId || input.field;
    const legacyRequestedId = requestedId
      ? state.decisions.find(
          (item) =>
            item.id.startsWith("legacy.v1.") &&
            item.inference.sourcePath === `answers.${requestedId}`,
        )?.id || null
      : null;
    const decisionId =
      (requestedId &&
      state.decisions.some((item) => item.id === requestedId)
        ? requestedId
        : legacyRequestedId) || currentQuestion?.field;
    const decision = state.decisions.find((item) => item.id === decisionId);
    if (!decision) {
      throw new SiteForgeGuidedError(
        "That discovery decision is not part of the current vertical pack.",
        400,
        "needs_attention",
        false,
      );
    }
    let value: unknown;
    try {
      value = validateAdaptiveDecisionAnswer(decision, input.answer);
    } catch (error) {
      throw new SiteForgeGuidedError(
        error instanceof Error
          ? error.message
          : decision.validation.message,
        400,
        "needs_attention",
        false,
      );
    }
    const routedAttachments = input.attachments
      .filter((attachment) => ["image", "floor_plan"].includes(attachment.kind))
      .map(visualRoute);
    const persistedAttachments = input.attachments.filter((attachment) =>
      ["reference", "document"].includes(attachment.kind),
    );
    const now = deps.now().toISOString();
    const decisionAnswers = {
      ...state.decisionAnswers,
      [decision.id]: {
        decisionId: decision.id,
        value,
        origin: "operator" as const,
        confidence: 1,
        evidenceIds: decision.evidenceIds,
        actor: { type: "user" as const, id: userId },
        confirmedAt: now,
      },
    };
    const answerHash = hashGuidedDecisionAnswers(decisionAnswers);
    const discoveryHash = hashSiteForgeContent({
      profile: state.sources.verticalProfile.contentHash,
      pack: state.sources.verticalPack.contentHash,
      evidence: state.sources.evidence.contextHash,
      decisionSetHash: state.decisionSetHash,
      answerHash,
    });
    const adaptiveAnswers = applyAdaptiveAnswersToCompatibility(
      state.answers,
      state.decisions,
      decisionAnswers,
    );
    const answers = decision.id.startsWith("legacy.v1.")
      ? updateGuidedAnswers(
          adaptiveAnswers,
          decision.inference.sourcePath.replace(
            "answers.",
            "",
          ) as Parameters<typeof updateGuidedAnswers>[1],
          input.answer,
        )
      : adaptiveAnswers;
    const progress = adaptiveDiscoveryProgress({
      ...state,
      decisionAnswers,
    });
    const nextQuestion = nextAdaptiveQuestion({
      ...state,
      decisionAnswers,
    });
    const next = guidedJourneyStateV2Schema.parse({
      ...state,
      revision: state.revision + 1,
      status: progress.complete
        ? "ready_to_prepare"
        : "discovering",
      answers,
      decisionAnswers,
      answerHash,
      discoveryHash,
      preparation: null,
      prepared: null,
      attachments: [...state.attachments, ...persistedAttachments],
      turns: [
        ...state.turns,
        {
          id: `${input.clientRequestId}:user`,
          clientRequestId: input.clientRequestId,
          role: "user",
          field: decision.id,
          content:
            typeof input.answer === "string"
              ? input.answer
              : JSON.stringify(input.answer),
          createdAt: now,
        },
        {
          id: `${input.clientRequestId}:assistant`,
          clientRequestId: input.clientRequestId,
          role: "assistant",
          field: nextQuestion?.field || null,
          content: nextQuestion
            ? `Thanks — ${nextQuestion.question}`
            : "Thanks — I have enough information to prepare a site recommendation.",
          createdAt: now,
        },
      ],
      lastError: null,
      updatedAt: now,
    });
    await persistState(next);
    return {
      ...(await snapshot(websiteId)),
      duplicate: false,
      routedAttachments,
    };
  }

  async function persistFailure(
    state: GuidedJourneyState,
    error: unknown,
  ): Promise<never> {
    console.error("[siteforge.guided] operation failed", {
      websiteId: state.websiteId,
      propertyId: state.propertyId,
      revision: state.revision,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    const classified = toSiteForgeGuidedError(error);
    try {
      await persistState({
        ...state,
        revision: state.revision + 1,
        status: "needs_attention",
        lastError: {
          kind: classified.kind,
          message: classified.message,
          retryable: classified.retryable,
        },
        updatedAt: deps.now().toISOString(),
      });
    } catch {
      // Preserve the original classified failure if failure recording is unavailable.
    }
    throw classified;
  }

  async function prepare(
    websiteId: string,
    input: { idempotencyKey: string },
    userId: string,
  ) {
    let state = await loadOrCreate(websiteId);
    const initialContext = await deps.loadAdaptiveContext(
      { orgId: state.orgId, propertyId: state.propertyId },
      deps.client,
    );
    const initiallyReconciled = reconcileAdaptiveState(state, initialContext);
    if (initiallyReconciled.discoveryHash !== state.discoveryHash) {
      state = await persistState({
        ...initiallyReconciled,
        revision: state.revision + 1,
        updatedAt: deps.now().toISOString(),
      });
    }
    if (
      state.prepared &&
      state.prepared.idempotencyKey === input.idempotencyKey
    ) {
      return { ...(await snapshot(websiteId)), duplicate: true };
    }
    if (state.prepared) {
      throw new SiteForgeGuidedError(
        "A recommendation is already prepared for this guided session.",
        409,
        "needs_attention",
        false,
      );
    }
    if (!adaptiveDiscoveryProgress(state).complete) {
      throw new SiteForgeGuidedError(
        "Finish the remaining discovery questions before preparing a recommendation.",
        409,
        "needs_attention",
        false,
      );
    }

    try {
      const existingOnboarding = await deps.client
        .from("property_onboarding_snapshots")
        .select("snapshot_payload")
        .eq("id", state.sources.onboardingSnapshotId)
        .single();
      const enabledCapabilities = strings(
        record(existingOnboarding.data?.snapshot_payload).enabledCapabilities,
      );
      const readiness = await deps.buildReadiness(
        {
          orgId: state.orgId,
          propertyId: state.propertyId,
          userId,
          enabledCapabilities,
        },
        deps.client,
      );
      let approvedReadiness = readiness;
      if (readiness.status === "ready") {
        approvedReadiness = await deps.approveReadiness(
          {
            orgId: state.orgId,
            propertyId: state.propertyId,
            snapshotId: readiness.id,
            userId,
          },
          deps.client,
        );
      }
      if (approvedReadiness.status !== "approved") {
        throw new GuidedJourneyError(
          "Property readiness has items that need review before SiteForge can recommend a build.",
          "needs_attention",
        );
      }
      const currentBriefSources = await deps.loadSources(
        { orgId: state.orgId, propertyId: state.propertyId },
        deps.client,
      );
      const currentAdaptiveContext = await deps.loadAdaptiveContext(
        { orgId: state.orgId, propertyId: state.propertyId },
        deps.client,
      );
      const currentSources = adaptiveSources(
        currentBriefSources,
        currentAdaptiveContext,
      );
      if (!sameSources(state.sources, currentSources)) {
        const refreshed = reconcileAdaptiveState(
          state,
          currentAdaptiveContext,
          currentSources,
        );
        state = await persistState({
          ...refreshed,
          revision: state.revision + 1,
          preparation: null,
          prepared: null,
          lastError: null,
          updatedAt: deps.now().toISOString(),
        });
      }

      state = await persistState({
        ...state,
        revision: state.revision + 1,
        status: "preparing",
        preparation: {
          idempotencyKey: input.idempotencyKey,
          briefVersionId: state.preparation?.briefVersionId || null,
          briefContentHash: state.preparation?.briefContentHash || null,
          directionSetId: state.preparation?.directionSetId || null,
          planId: state.preparation?.planId || null,
          updatedAt: deps.now().toISOString(),
        },
        lastError: null,
        updatedAt: deps.now().toISOString(),
      });

      const siteStory = synthesizeSiteStory(currentAdaptiveContext);
      const briefPayload = buildAdaptiveGuidedBrief({
        propertyName: state.propertyName,
        answers: state.answers,
        context: currentAdaptiveContext,
        story: siteStory.story,
        attachmentReferences: state.attachments.map(attachmentReference),
      });
      const expectedBriefHash = hashSiteForgeBrief({
        brief: briefPayload,
        unresolvedContradictions: [],
        sources: currentBriefSources,
      });
      let brief = state.preparation?.briefVersionId
        ? await deps.getBrief(
            state.preparation.briefVersionId,
            state.propertyId,
            deps.client,
          )
        : null;
      if (!brief || brief.contentHash !== expectedBriefHash) {
        const matching = (
          await deps.listBriefs({ websiteId: state.websiteId }, deps.client)
        ).find(
          (candidate) =>
            candidate.contentHash === expectedBriefHash &&
            candidate.status === "approved",
        );
        brief =
          matching ||
          (await deps.saveBrief(
            {
              websiteId: state.websiteId,
              userId,
              brief: briefPayload,
              unresolvedContradictions: [],
              expectedVersion:
                (
                  await deps.listBriefs(
                    { websiteId: state.websiteId },
                    deps.client,
                  )
                )[0]?.version || 0,
            },
            deps.client,
          ));
      }
      state = await persistState({
        ...state,
        revision: state.revision + 1,
        preparation: {
          ...state.preparation!,
          briefVersionId: brief.id,
          briefContentHash: brief.contentHash,
          updatedAt: deps.now().toISOString(),
        },
        updatedAt: deps.now().toISOString(),
      });

      let directionSet = state.preparation?.directionSetId
        ? await deps.getDirections(
            state.preparation.directionSetId,
            state.propertyId,
            deps.client,
          )
        : await deps.createDirections(
            {
              briefVersionId: brief.id,
              propertyId: state.propertyId,
              userId,
            },
            deps.client,
          );
      const scored = scoreGuidedDirections(
        directionSet.directions,
        state.answers,
      );
      const recommended = scored[0];
      if (!recommended) {
        throw new GuidedJourneyError(
          "SiteForge could not create a usable creative recommendation.",
          "temporary",
          true,
        );
      }
      const recommendedCandidate = directionSet.directions.find(
        (direction) => direction.id === recommended.id,
      );
      if (!recommendedCandidate) {
        throw new GuidedJourneyError(
          "SiteForge could not resolve the recommended creative direction.",
          "temporary",
          true,
        );
      }
      if (
        directionSet.selectedDirectionId !== recommended.id ||
        directionSet.status === "draft"
      ) {
        directionSet = await deps.selectDirection(
          {
            directionSetId: directionSet.id,
            propertyId: state.propertyId,
            selectedDirectionId: recommended.id,
            expectedContentHash: directionSet.contentHash,
            selectionNotes: recommended.reason,
          },
          deps.client,
        );
      }
      state = await persistState({
        ...state,
        revision: state.revision + 1,
        preparation: {
          ...state.preparation!,
          directionSetId: directionSet.id,
          updatedAt: deps.now().toISOString(),
        },
        updatedAt: deps.now().toISOString(),
      });

      const referenceUrl = state.answers.references?.find(
        (item) => item.url,
      )?.url;
      const verticalActivation = await resolveVerticalActivation(
        {
          websiteId: state.websiteId,
          propertyId: state.propertyId,
          orgId: state.orgId,
        },
        currentAdaptiveContext,
        deps.client,
      );
      const plan = state.preparation?.planId
        ? await deps.getPlan(
            {
              planId: state.preparation.planId,
              websiteId: state.websiteId,
              propertyId: state.propertyId,
              orgId: state.orgId,
            },
            deps.client,
          )
        : await deps.createPlan(
            {
              websiteId: state.websiteId,
              propertyId: state.propertyId,
              userId,
              preferences: {
                ...(state.answers.primaryAction
                  ? { ctaPriority: state.answers.primaryAction }
                  : {}),
                referenceSiteUrl: referenceUrl,
                contentDensity: "balanced",
                motion: "subtle",
                enabledCapabilities,
              },
              operatorDirection: [
                state.answers.objective,
                state.answers.successSignal
                  ? `Success: ${state.answers.successSignal}`
                  : null,
                `Vertical manifest: ${currentAdaptiveContext.manifest.contentHash}`,
                state.answers.offers?.length
                  ? `Verified offers: ${state.answers.offers.join(", ")}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n"),
              conversationHistory: state.turns.map((turn) => ({
                role: turn.role,
                content: turn.content,
                timestamp: turn.createdAt,
              })),
              ...(verticalActivation.useV2
                ? {
                    verticalContext: currentAdaptiveContext,
                    discovery: {
                      decisionSetHash: state.decisionSetHash,
                      answerHash: state.answerHash,
                      discoveryHash: state.discoveryHash,
                    },
                    siteStory: {
                      contract: siteStory.story,
                      identity: siteStory.identity,
                    },
                    selectedCreativeDirection: {
                      ...recommendedCandidate,
                      id: recommendedCandidate.id,
                    },
                  }
                : {}),
            },
            deps.client,
          );
      state = await persistState({
        ...state,
        revision: state.revision + 1,
        preparation: {
          ...state.preparation!,
          planId: plan.planId,
          updatedAt: deps.now().toISOString(),
        },
        updatedAt: deps.now().toISOString(),
      });
      const now = deps.now().toISOString();
      const prepared = {
        idempotencyKey: input.idempotencyKey,
        briefVersionId: brief.id,
        briefContentHash: brief.contentHash,
        directionSetId: directionSet.id,
        directionSetContentHash: directionSet.contentHash,
        recommendedDirectionId: recommended.id,
        selectedDirectionContentHash: recommendedCandidate.contentHash,
        recommendedDirectionName: recommended.name,
        recommendedDirectionScore: recommended.score,
        recommendationReason: recommended.reason,
        scoredDirections: scored,
        planId: plan.planId,
        planVersionId: plan.planVersionId,
        planRevision: plan.revision,
        planContentHash: plan.contentHash,
        verticalProfileContentHash:
          state.sources.verticalProfile.contentHash,
        verticalPackContentHash: state.sources.verticalPack.contentHash,
        decisionSetHash: state.decisionSetHash,
        answerHash: state.answerHash,
        discoveryHash: state.discoveryHash,
        preparedAt: now,
      };
      await persistState({
        ...state,
        revision: state.revision + 1,
        status: "ready_to_build",
        preparation: {
          ...state.preparation!,
          updatedAt: now,
        },
        prepared,
        lastError: null,
        updatedAt: now,
      });
      return {
        ...(await snapshot(websiteId)),
        duplicate: false,
        scoredDirections: scored,
      };
    } catch (error) {
      return persistFailure(state, error);
    }
  }

  async function confirm(
    websiteId: string,
    input: {
      idempotencyKey: string;
      expected: {
        briefContentHash: string;
        directionSetContentHash: string;
        planContentHash: string;
      };
    },
    userId: string,
    startGeneration: GenerationStart,
  ) {
    let state = await loadOrCreate(websiteId);
    if (state.generation) {
      return { ...(await snapshot(websiteId)), duplicate: true };
    }
    const prepared = state.prepared;
    if (!prepared) {
      throw new SiteForgeGuidedError(
        "Prepare a recommendation before building.",
        409,
        "needs_attention",
        false,
      );
    }
    if (
      prepared.briefContentHash !== input.expected.briefContentHash ||
      prepared.directionSetContentHash !==
        input.expected.directionSetContentHash ||
      prepared.planContentHash !== input.expected.planContentHash
    ) {
      throw new SiteForgeGuidedError(
        "The recommendation changed. Reload it before building.",
        409,
        "source_changed",
        false,
      );
    }

    try {
      const [currentBriefSources, currentAdaptiveContext] = await Promise.all([
        deps.loadSources(
          { orgId: state.orgId, propertyId: state.propertyId },
          deps.client,
        ),
        deps.loadAdaptiveContext(
          { orgId: state.orgId, propertyId: state.propertyId },
          deps.client,
        ),
      ]);
      const currentSources = adaptiveSources(
        currentBriefSources,
        currentAdaptiveContext,
      );
      if (!sameSources(state.sources, currentSources)) {
        throw new GuidedJourneyError(
          "The vertical profile, pack, property evidence, or brand information changed after the recommendation was prepared.",
          "source_changed",
        );
      }
      if (
        prepared.verticalProfileContentHash !==
          state.sources.verticalProfile.contentHash ||
        prepared.verticalPackContentHash !==
          state.sources.verticalPack.contentHash ||
        prepared.decisionSetHash !== state.decisionSetHash ||
        prepared.answerHash !== state.answerHash ||
        prepared.discoveryHash !== state.discoveryHash
      ) {
        throw new GuidedJourneyError(
          "Discovery decisions changed after the recommendation was prepared.",
          "source_changed",
        );
      }
      const brief = await deps.getBrief(
        prepared.briefVersionId,
        state.propertyId,
        deps.client,
      );
      if (
        brief.status !== "approved" ||
        brief.contentHash !== prepared.briefContentHash
      ) {
        throw new GuidedJourneyError(
          "The prepared brief is no longer current.",
          "source_changed",
        );
      }
      let directions = await deps.getDirections(
        prepared.directionSetId,
        state.propertyId,
        deps.client,
      );
      if (
        directions.contentHash !== prepared.directionSetContentHash ||
        directions.selectedDirectionId !== prepared.recommendedDirectionId
      ) {
        throw new GuidedJourneyError(
          "The prepared creative recommendation changed.",
          "source_changed",
        );
      }
      if (directions.status !== "approved") {
        directions = await deps.confirmDirection(
          {
            directionSetId: directions.id,
            propertyId: state.propertyId,
            selectedDirectionId: prepared.recommendedDirectionId,
            expectedContentHash: prepared.directionSetContentHash,
            selectionNotes: directions.selectionNotes,
            reviewerProfileId: userId,
          },
          deps.client,
        );
      }
      let plan = await deps.getPlan(
        {
          planId: prepared.planId,
          websiteId: state.websiteId,
          propertyId: state.propertyId,
          orgId: state.orgId,
        },
        deps.client,
      );
      if (
        plan.revision !== prepared.planRevision ||
        plan.contentHash !== prepared.planContentHash
      ) {
        throw new GuidedJourneyError(
          "The prepared implementation plan changed.",
          "source_changed",
        );
      }
      if (plan.status === "ready_for_review") {
        await deps.decidePlan(
          {
            planId: plan.planId,
            websiteId: state.websiteId,
            propertyId: state.propertyId,
            orgId: state.orgId,
            expectedRevision: plan.revision,
            contentHash: plan.contentHash,
            reviewerProfileId: userId,
            decisionStatus: "approved",
            decisionReason: "siteforge.guided:build_this_site:v1",
          },
          deps.client,
        );
        plan = await deps.getPlan(
          {
            planId: plan.planId,
            websiteId: state.websiteId,
            propertyId: state.propertyId,
            orgId: state.orgId,
          },
          deps.client,
        );
      }
      if (!["confirmed", "consumed"].includes(plan.status)) {
        throw new GuidedJourneyError(
          "The implementation plan is not ready to build.",
          "needs_attention",
        );
      }
      const stableGenerationKey = hashSiteForgeContent({
        schemaVersion: 1,
        action: "siteforge.guided.generate",
        websiteId: state.websiteId,
        planId: plan.planId,
        revision: plan.revision,
        contentHash: plan.contentHash,
      });
      const generation = await startGeneration({
        websiteId: state.websiteId,
        planId: plan.planId,
        confirmedRevision: plan.revision,
        contentHash: plan.contentHash,
        idempotencyKey: stableGenerationKey,
      });
      const now = deps.now().toISOString();
      state = await persistState({
        ...state,
        revision: state.revision + 1,
        status: "building",
        generation: {
          jobId: generation.jobId,
          status: generation.status,
          workflowRunId: generation.workflowRunId,
          duplicate: generation.duplicate || false,
          startedAt: now,
        },
        lastError: null,
        updatedAt: now,
      });
      return {
        ...(await snapshot(websiteId)),
        duplicate: generation.duplicate || false,
      };
    } catch (error) {
      const classified = toSiteForgeGuidedError(error);
      if (classified.kind === "source_changed") {
        state = guidedJourneyStateV2Schema.parse({
          ...state,
          preparation: null,
          prepared: null,
          generation: null,
        });
      }
      return persistFailure(state, error);
    }
  }

  async function editDirection(
    websiteId: string,
    input: {
      clientRequestId: string;
      instruction?: string;
      alternativeDirectionId?: string;
      expectedRevision: number;
      expected: {
        directionSetContentHash: string;
        selectedDirectionContentHash: string;
      };
    },
    userId: string,
  ) {
    const state = await loadOrCreate(websiteId);
    if (!state.prepared || state.generation) {
      throw new SiteForgeGuidedError(
        "Prepare a recommendation before editing its creative direction.",
        409,
        "needs_attention",
        false,
      );
    }
    if (input.expectedRevision !== state.revision) {
      throw new SiteForgeGuidedError(
        "The recommendation changed. Reload it before editing.",
        409,
        "source_changed",
        false,
      );
    }
    const duplicateTurn = state.turns.find(
      (turn) =>
        turn.role === "user" &&
        turn.clientRequestId === input.clientRequestId,
    );
    if (duplicateTurn) {
      return { ...(await snapshot(websiteId)), duplicate: true };
    }
    const baseInput = {
      directionSetId: state.prepared.directionSetId,
      propertyId: state.propertyId,
      selectedDirectionId: state.prepared.recommendedDirectionId,
      expectedSetContentHash: input.expected.directionSetContentHash,
      expectedDirectionContentHash:
        input.expected.selectedDirectionContentHash,
      clientRequestId: input.clientRequestId,
      actorId: userId,
    };
    const instruction =
      input.instruction ||
      `Select alternative creative direction ${input.alternativeDirectionId}.`;
    const result = input.alternativeDirectionId
      ? await deps.selectDirectionAlternative(
          {
            ...baseInput,
            alternativeDirectionId: input.alternativeDirectionId,
          },
          deps.client,
        )
      : await deps.editDirection(
          { ...baseInput, instruction },
          deps.client,
        );
    if (result.outcome.outcome !== "patch") {
      const now = deps.now().toISOString();
      const assistantContent =
        result.outcome.outcome === "clarification"
          ? result.outcome.question
          : result.outcome.reason;
      await persistState({
        ...state,
        revision: state.revision + 1,
        turns: [
          ...state.turns,
          {
            id: `${input.clientRequestId}:user`,
            clientRequestId: input.clientRequestId,
            role: "user",
            field: null,
            content: instruction,
            createdAt: now,
          },
          {
            id: `${input.clientRequestId}:assistant`,
            clientRequestId: input.clientRequestId,
            role: "assistant",
            field: null,
            content: assistantContent,
            createdAt: now,
          },
        ],
        updatedAt: now,
      });
      return {
        ...(await snapshot(websiteId)),
        duplicate: false,
        editOutcome: result.outcome,
      };
    }
    const selected = result.directionSet.directions.find(
      (direction) =>
        direction.id === result.directionSet.selectedDirectionId,
    );
    if (!selected) {
      throw new SiteForgeGuidedError(
        "The revised creative direction could not be resumed.",
        500,
        "temporary",
        true,
      );
    }
    const now = deps.now().toISOString();
    await persistState({
      ...state,
      revision: state.revision + 1,
      prepared: {
        ...state.prepared,
        directionSetId: result.directionSet.id,
        directionSetContentHash: result.directionSet.contentHash,
        recommendedDirectionId: selected.id,
        recommendedDirectionName: selected.name,
        selectedDirectionContentHash: selected.contentHash,
        recommendationReason: result.outcome.summary,
      },
      preparation: state.preparation
        ? {
            ...state.preparation,
            directionSetId: result.directionSet.id,
            updatedAt: now,
          }
        : null,
      turns: [
        ...state.turns,
        {
          id: `${input.clientRequestId}:user`,
          clientRequestId: input.clientRequestId,
          role: "user",
          field: null,
          content: instruction,
          createdAt: now,
        },
        {
          id: `${input.clientRequestId}:assistant`,
          clientRequestId: input.clientRequestId,
          role: "assistant",
          field: null,
          content: result.outcome.summary,
          createdAt: now,
        },
      ],
      updatedAt: now,
    });
    return {
      ...(await snapshot(websiteId)),
      duplicate: result.duplicate,
      editOutcome: result.outcome,
    };
  }

  return { snapshot, conversation, prepare, confirm, editDirection };
}

let singleton: ReturnType<typeof createSiteForgeGuidedService> | null = null;

export function siteForgeGuidedService() {
  singleton ||= createSiteForgeGuidedService();
  return singleton;
}
