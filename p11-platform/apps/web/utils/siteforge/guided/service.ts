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
} from "@/utils/siteforge/directions/repository";
import {
  createPlanRevision,
  decideSiteForgePlan,
  getCurrentPlanRevision,
} from "@/utils/siteforge/plans/repository";
import { normalizeBrandAssetRow } from "@/utils/brandforge/normalize";
import { brandContextFromContract } from "@/utils/siteforge/brand-contract-adapter";
import { hashSiteForgeContent } from "@/utils/siteforge/content-hash";
import {
  guidedJourneyStateSchema,
  type GuidedAttachment,
  type GuidedJourneyState,
} from "./contracts";
import {
  buildGuidedBrief,
  classifyGuidedError,
  guidedDiscoveryProgress,
  inferGuidedAnswersFromTruth,
  nextGuidedQuestion,
  projectGuidedJourney,
  scoreGuidedDirections,
  updateGuidedAnswers,
  GuidedJourneyError,
} from "./journey";

type ServiceClient = ReturnType<typeof createServiceClient>;

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
    left.brandContractHash === right.brandContractHash
  );
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
    const parsed = guidedJourneyStateSchema.safeParse(data.context_payload);
    if (!parsed.success) {
      throw new GuidedJourneyError(
        "The saved guided session needs attention before it can resume.",
        "needs_attention",
      );
    }
    return parsed.data;
  }

  async function persistState(
    state: GuidedJourneyState,
  ): Promise<GuidedJourneyState> {
    const parsed = guidedJourneyStateSchema.parse(state);
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
    const [{ data: onboarding }, { data: brandRow }, { data: property }] =
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
      ]);
    if (!onboarding || !brandRow || !property?.name) {
      throw new SiteForgeGuidedError(
        "Complete and approve property readiness before starting SiteForge.",
        409,
        "needs_attention",
        false,
      );
    }
    const brandContract = normalizeBrandAssetRow(
      brandRow as unknown as Record<string, unknown>,
    );
    const brandContext = brandContextFromContract(brandContract);
    const answers = inferGuidedAnswersFromTruth({
      brandDifferentiators: brandContext.positioning.differentiators,
      renterPriorities: brandContext.targetAudience.priorities,
    });
    const now = deps.now().toISOString();
    const firstQuestion = nextGuidedQuestion(answers);
    const state = guidedJourneyStateSchema.parse({
      schemaVersion: 1,
      websiteId,
      propertyId: website.property_id,
      orgId: website.org_id,
      propertyName: property.name,
      revision: 0,
      status: "discovering",
      answers,
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
        : [],
      attachments: [],
      sources,
      preparation: null,
      prepared: null,
      generation: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
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
    const [state, website] = await Promise.all([
      loadOrCreate(websiteId),
      loadWebsite(websiteId),
    ]);
    const question = nextGuidedQuestion(state.answers);
    return {
      state,
      question,
      journey: projectGuidedJourney(state, {
        generationStatus: website.generation_status,
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
      field?: Parameters<typeof updateGuidedAnswers>[1];
      answer: unknown;
      attachments: GuidedAttachment[];
    },
  ) {
    const state = await loadOrCreate(websiteId);
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
    if (state.prepared || state.generation) {
      throw new SiteForgeGuidedError(
        "This recommendation is already prepared. Start a new guided session to change discovery answers.",
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
    const currentQuestion = nextGuidedQuestion(state.answers);
    if (!currentQuestion) {
      throw new SiteForgeGuidedError(
        "Discovery is complete. Prepare the recommendation next.",
        409,
        "needs_attention",
        false,
      );
    }
    const field = input.field || currentQuestion.field;
    if (field !== currentQuestion.field) {
      throw new SiteForgeGuidedError(
        "Answer the current question before moving to another discovery topic.",
        409,
        "needs_attention",
        false,
      );
    }
    const answers = updateGuidedAnswers(state.answers, field, input.answer);
    const routedAttachments = input.attachments
      .filter((attachment) => ["image", "floor_plan"].includes(attachment.kind))
      .map(visualRoute);
    const persistedAttachments = input.attachments.filter((attachment) =>
      ["reference", "document"].includes(attachment.kind),
    );
    const now = deps.now().toISOString();
    const nextQuestion = nextGuidedQuestion(answers);
    const next = guidedJourneyStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      status: guidedDiscoveryProgress(answers).complete
        ? "ready_to_prepare"
        : "discovering",
      answers,
      attachments: [...state.attachments, ...persistedAttachments],
      turns: [
        ...state.turns,
        {
          id: `${input.clientRequestId}:user`,
          clientRequestId: input.clientRequestId,
          role: "user",
          field,
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
    if (!guidedDiscoveryProgress(state.answers).complete) {
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
      if (
        state.answers.primaryAction === "tours" &&
        !enabledCapabilities.includes("tours")
      ) {
        enabledCapabilities.push("tours");
      }
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
      const currentSources = await deps.loadSources(
        { orgId: state.orgId, propertyId: state.propertyId },
        deps.client,
      );
      if (!sameSources(state.sources, currentSources)) {
        state = await persistState({
          ...state,
          revision: state.revision + 1,
          sources: currentSources,
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

      const briefPayload = buildGuidedBrief({
        propertyName: state.propertyName,
        answers: state.answers,
        attachmentReferences: state.attachments.map(attachmentReference),
      });
      const expectedBriefHash = hashSiteForgeBrief({
        brief: briefPayload,
        unresolvedContradictions: [],
        sources: currentSources,
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
                ctaPriority: state.answers.primaryAction!,
                referenceSiteUrl: referenceUrl,
                contentDensity: "balanced",
                motion: "subtle",
                enabledCapabilities,
              },
              siteType: "standard",
              operatorDirection: [
                state.answers.objective,
                `Success: ${state.answers.successSignal}`,
                `Pages: ${state.answers.pageScope!.included.join(", ")}`,
                state.answers.offers!.length
                  ? `Verified offers: ${state.answers.offers!.join(", ")}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n"),
              conversationHistory: state.turns.map((turn) => ({
                role: turn.role,
                content: turn.content,
                timestamp: turn.createdAt,
              })),
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
        recommendedDirectionName: recommended.name,
        recommendedDirectionScore: recommended.score,
        recommendationReason: recommended.reason,
        scoredDirections: scored,
        planId: plan.planId,
        planVersionId: plan.planVersionId,
        planRevision: plan.revision,
        planContentHash: plan.contentHash,
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
      const currentSources = await deps.loadSources(
        { orgId: state.orgId, propertyId: state.propertyId },
        deps.client,
      );
      if (!sameSources(state.sources, currentSources)) {
        throw new GuidedJourneyError(
          "Property or brand information changed after the recommendation was prepared.",
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
        state = guidedJourneyStateSchema.parse({
          ...state,
          preparation: null,
          prepared: null,
          generation: null,
        });
      }
      return persistFailure(state, error);
    }
  }

  return { snapshot, conversation, prepare, confirm };
}

let singleton: ReturnType<typeof createSiteForgeGuidedService> | null = null;

export function siteForgeGuidedService() {
  singleton ||= createSiteForgeGuidedService();
  return singleton;
}
