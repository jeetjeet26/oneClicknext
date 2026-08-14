import { describe, expect, it } from "vitest";
import { guidedAnswersSchema, guidedJourneyStateSchema } from "./contracts";
import {
  buildGuidedBrief,
  classifyGuidedError,
  guidedDiscoveryProgress,
  inferGuidedAnswersFromTruth,
  nextGuidedQuestion,
  projectGuidedJourney,
  scoreGuidedDirections,
  updateGuidedAnswers,
} from "./journey";

function completeAnswers() {
  return guidedAnswersSchema.parse({
    objective: "Increase qualified tour requests",
    successSignal: "More completed tour bookings",
    renterNeeds: [
      "Floor-plan details",
      "Verified amenities",
      "Leasing contact options",
    ],
    primaryAction: "tours",
    pageScope: {
      included: ["Home", "Floor Plans", "Amenities", "Contact"],
      excluded: ["Resident portal"],
    },
    differentiators: ["Transit access", "Flexible shared spaces"],
    offers: [],
    deadline: { date: null, flexibility: "flexible" },
    references: [],
    constraints: ["Use only approved availability"],
  });
}

function state(overrides: Record<string, unknown> = {}) {
  return guidedJourneyStateSchema.parse({
    schemaVersion: 1,
    websiteId: "website-1",
    propertyId: "property-1",
    orgId: "org-1",
    propertyName: "Aurora",
    revision: 1,
    status: "ready_to_prepare",
    answers: completeAnswers(),
    turns: [],
    attachments: [],
    sources: {
      onboardingSnapshotId: "snapshot-1",
      onboardingSnapshotHash: "a".repeat(64),
      brandAssetId: "brand-1",
      brandContractHash: "b".repeat(64),
    },
    preparation: null,
    prepared: null,
    generation: null,
    lastError: null,
    createdAt: "2026-08-13T18:00:00.000Z",
    updatedAt: "2026-08-13T18:00:00.000Z",
    ...overrides,
  });
}

describe("SiteForge guided journey", () => {
  it("asks exactly one next unanswered question and resumes progress", () => {
    let answers = guidedAnswersSchema.parse({});
    expect(nextGuidedQuestion(answers)?.field).toBe("objective");

    answers = updateGuidedAnswers(
      answers,
      "objective",
      "Increase qualified leasing conversations",
    );
    expect(nextGuidedQuestion(answers)?.field).toBe("successSignal");
    expect(guidedDiscoveryProgress(answers)).toMatchObject({
      answered: 1,
      total: 10,
      complete: false,
    });
  });

  it("uses safe BrandForge truth and ignores unsafe audience inference", () => {
    const answers = inferGuidedAnswersFromTruth({
      brandDifferentiators: ["Transit access", "Safe neighborhood"],
      renterPriorities: ["Floor-plan details", "Perfect for families"],
    });
    expect(answers.differentiators).toEqual(["Transit access"]);
    expect(answers.renterNeeds).toEqual(["Floor-plan details"]);
  });

  it("rejects protected-class targeting in renter needs", () => {
    expect(() =>
      updateGuidedAnswers(
        guidedAnswersSchema.parse({}),
        "renterNeeds",
        "Perfect for families, near transit",
      ),
    ).toThrow(/protected groups/i);
  });

  it("constructs a complete Fair Housing-safe structured brief", () => {
    const brief = buildGuidedBrief({
      propertyName: "Aurora",
      answers: completeAnswers(),
      attachmentReferences: [
        { label: "Approved brand notes", sourceId: "doc-1" },
      ],
    });
    expect(brief.objectives[0]).toMatchObject({
      statement: "Increase qualified tour requests",
      successSignal: "More completed tour bookings",
    });
    expect(brief.audiences[0]).toEqual({
      segment: "Prospective residents",
      needs: [
        "Floor-plan details",
        "Verified amenities",
        "Leasing contact options",
      ],
      objections: [],
    });
    expect(brief.conversion.primaryAction).toBe("Schedule a tour");
    expect(brief.references[0].sourceId).toBe("doc-1");
    expect(JSON.stringify(brief)).not.toMatch(/families|safe neighborhood/i);
  });

  it("scores and recommends one deterministic creative direction", () => {
    const scored = scoreGuidedDirections(
      [
        {
          id: "editorial",
          name: "Editorial",
          direction: { cta: { label: "Explore" } },
        },
        {
          id: "conversion",
          name: "Conversion Clarity",
          direction: {
            cta: { label: "Schedule a tour" },
            voice: { traits: ["Clear", "Useful"] },
          },
        },
      ],
      completeAnswers(),
    );
    expect(scored[0]).toMatchObject({
      id: "conversion",
      score: 91,
    });
  });

  it("projects resume, source-change, retry, and preview states plainly", () => {
    expect(projectGuidedJourney(state()).stage).toBe("assets");
    expect(
      projectGuidedJourney(
        state({
          status: "needs_attention",
          lastError: {
            kind: "source_changed",
            message: "Property information changed.",
            retryable: false,
          },
        }),
      ),
    ).toMatchObject({
      headline: "Property information changed",
      retryable: false,
    });
    expect(
      classifyGuidedError(new Error("provider temporarily unavailable")),
    ).toMatchObject({
      kind: "temporary",
      retryable: true,
      statusCode: 503,
    });
    expect(
      projectGuidedJourney(
        state({
          status: "building",
          generation: {
            jobId: "job-1",
            status: "queued",
            duplicate: false,
            startedAt: "2026-08-13T18:00:00.000Z",
          },
        }),
        {
          generationStatus: "ready_for_preview",
          previewUrl: "https://preview.test",
        },
      ),
    ).toMatchObject({
      stage: "preview",
      previewUrl: "https://preview.test",
    });
    expect(
      projectGuidedJourney(state(), {
        generationStatus: "ready_for_preview",
        previewUrl: "https://legacy-preview.test",
      }),
    ).toMatchObject({
      stage: "preview",
      previewUrl: "https://legacy-preview.test",
    });
    expect(
      projectGuidedJourney(
        state({
          status: "building",
          generation: {
            jobId: "job-1",
            status: "succeeded",
            duplicate: false,
            startedAt: "2026-08-13T18:00:00.000Z",
          },
        }),
        { productionUrl: "https://aurora.example" },
      ),
    ).toMatchObject({
      stage: "launch",
      previewUrl: "https://aurora.example",
    });
    expect(
      projectGuidedJourney(
        state({
          status: "building",
          generation: {
            jobId: "job-1",
            status: "running",
            duplicate: false,
            startedAt: "2026-08-13T18:00:00.000Z",
          },
        }),
        {
          generationStatus: "failed",
          generationFailureReason:
            "A temporary provider problem interrupted the build.",
          generationRetryable: true,
          failedCheckpoint: "generating_content",
        },
      ),
    ).toMatchObject({
      stage: "build",
      headline: "The build needs attention",
      blocker: "A temporary provider problem interrupted the build.",
      retryable: true,
      recommendedAction: "Retry this build",
    });
    expect(
      projectGuidedJourney(
        state({
          generation: {
            jobId: "job-1",
            status: "running",
            duplicate: false,
            startedAt: "2026-08-13T18:00:00.000Z",
          },
        }),
        { generationStatus: "cancelled" },
      ),
    ).toMatchObject({
      stage: "build",
      headline: "The build was cancelled",
      retryable: false,
    });
  });
});
