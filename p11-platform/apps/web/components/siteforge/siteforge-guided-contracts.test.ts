import { describe, expect, it } from "vitest";
import type { SiteForgeDirectorSnapshot } from "@/utils/siteforge/director/contracts";
import {
  guidedAnswersSchema,
  guidedJourneyStateSchema,
} from "@/utils/siteforge/guided/contracts";
import type { GuidedJourneyProjection } from "@/utils/siteforge/guided/journey";
import {
  buildGuidedJourney,
  buildPreparedRecommendation,
  friendlySiteForgeError,
  inferGuidedStep,
  plainSiteForgeProgress,
} from "./siteforge-guided-contracts";

function snapshot(
  stage: SiteForgeDirectorSnapshot["stage"]["key"],
): SiteForgeDirectorSnapshot {
  return {
    stage: { key: stage, label: stage, status: "active", detail: "" },
  } as SiteForgeDirectorSnapshot;
}

function projection(
  stage: GuidedJourneyProjection["stage"],
  blocker: string | null = null,
): GuidedJourneyProjection {
  return {
    stage,
    headline: "Guided stage",
    explanation: "Guided explanation",
    recommendedAction: "Continue",
    progress: {
      answered: 0,
      total: 10,
      percent: 0,
      requiredComplete: false,
      complete: false,
    },
    blocker,
    retryable: Boolean(blocker),
    previewUrl: null,
  };
}

describe("SiteForge guided journey projection", () => {
  it("uses durable guided state before director fallback", () => {
    expect(inferGuidedStep(snapshot("preview"), projection("assets"))).toBe(
      "visuals",
    );
    expect(inferGuidedStep(snapshot("generation"))).toBe("progress");
  });

  it("includes launch and marks the blocked current stage", () => {
    const items = buildGuidedJourney(
      snapshot("generation"),
      projection("launch", "Production needs attention"),
    );
    expect(items.map((item) => item.id)).toEqual([
      "conversation",
      "visuals",
      "recommendation",
      "build",
      "progress",
      "preview",
      "launch",
    ]);
    expect(items.at(-1)?.state).toBe("needs_attention");
  });

  it("rebuilds full recommendation detail from persisted prepared state", () => {
    const state = guidedJourneyStateSchema.parse({
      schemaVersion: 1,
      websiteId: "website-1",
      propertyId: "property-1",
      orgId: "org-1",
      propertyName: "Aurora",
      revision: 12,
      status: "ready_to_build",
      answers: guidedAnswersSchema.parse({
        objective: "Increase tour requests",
        successSignal: "More completed bookings",
        renterNeeds: ["Floor-plan details"],
        primaryAction: "tours",
        pageScope: { included: ["Home", "Floor Plans"], excluded: [] },
        differentiators: ["Transit access"],
        offers: [],
        deadline: { date: null, flexibility: "flexible" },
        references: [],
        constraints: [],
      }),
      turns: [],
      attachments: [],
      sources: {
        onboardingSnapshotId: "snapshot-1",
        onboardingSnapshotHash: "a".repeat(64),
        brandAssetId: "brand-1",
        brandContractHash: "b".repeat(64),
      },
      preparation: null,
      prepared: {
        idempotencyKey: "prepare-1",
        briefVersionId: "brief-1",
        briefContentHash: "c".repeat(64),
        directionSetId: "directions-1",
        directionSetContentHash: "d".repeat(64),
        recommendedDirectionId: "direction-1",
        recommendedDirectionName: "Conversion Clarity",
        recommendedDirectionScore: 94,
        recommendationReason: "Best fit for tour conversion.",
        scoredDirections: [
          {
            id: "direction-1",
            name: "Conversion Clarity",
            score: 94,
            reason: "Best fit for tour conversion.",
          },
        ],
        planId: "plan-1",
        planVersionId: "version-1",
        planRevision: 1,
        planContentHash: "e".repeat(64),
        preparedAt: "2026-08-13T18:00:00.000Z",
      },
      generation: null,
      lastError: null,
      createdAt: "2026-08-13T18:00:00.000Z",
      updatedAt: "2026-08-13T18:00:00.000Z",
    });
    expect(buildPreparedRecommendation(state)).toMatchObject({
      headline: "Conversion Clarity for Aurora",
      visualDirection: "Conversion Clarity — Best fit for tour conversion.",
      pages: [{ name: "Home" }, { name: "Floor Plans" }],
    });
  });
});

describe("SiteForge user-facing helpers", () => {
  it("hides technical identifiers and translates progress", () => {
    expect(
      friendlySiteForgeError(
        "ZodError: invalid uuid 6ba7b810-9dad-41d1-80b4-00c04fd430c8",
      ),
    ).toBe("SiteForge could not complete that step. Please try again.");
    expect(
      plainSiteForgeProgress(
        "blueprint_generation",
        "persist_artifact_content_hash",
      ),
    ).toBe("Designing pages and layout");
  });
});
