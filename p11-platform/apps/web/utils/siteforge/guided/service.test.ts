import { describe, expect, it, vi } from "vitest";
import { guidedAnswersSchema, guidedJourneyStateSchema } from "./contracts";
import { createSiteForgeGuidedService } from "./service";

function initialState() {
  return guidedJourneyStateSchema.parse({
    schemaVersion: 1,
    websiteId: "website-1",
    propertyId: "property-1",
    orgId: "org-1",
    propertyName: "Aurora",
    revision: 0,
    status: "discovering",
    answers: guidedAnswersSchema.parse({}),
    turns: [
      {
        id: "welcome:assistant",
        clientRequestId: "welcome",
        role: "assistant",
        field: "objective",
        content: "What is the most important job this website should do?",
        createdAt: "2026-08-13T18:00:00.000Z",
      },
    ],
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
  });
}

function readyState() {
  return guidedJourneyStateSchema.parse({
    ...initialState(),
    revision: 10,
    status: "ready_to_prepare",
    answers: guidedAnswersSchema.parse({
      objective: "Increase qualified tour requests",
      successSignal: "More completed tour bookings",
      renterNeeds: ["Floor-plan details"],
      primaryAction: "tours",
      pageScope: { included: ["Home", "Floor Plans"], excluded: [] },
      differentiators: ["Transit access"],
      offers: [],
      deadline: { date: null, flexibility: "flexible" },
      references: [],
      constraints: [],
    }),
  });
}

function fakeClient(seed = initialState()) {
  const snapshots: Array<{
    id: string;
    context_hash: string;
    context_payload: unknown;
    source_ref: string;
  }> = [
    {
      id: "context-0",
      context_hash: "seed",
      context_payload: seed,
      source_ref: "website:website-1:revision:0",
    },
  ];

  const client = {
    from(table: string) {
      if (table === "property_websites") {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          single: vi.fn(async () => ({
            data: {
              id: "website-1",
              property_id: "property-1",
              org_id: "org-1",
              generation_status: null,
              canonical_preview_url: null,
              staging_url: null,
            },
            error: null,
          })),
        };
        return chain;
      }
      if (table === "property_onboarding_snapshots") {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          single: vi.fn(async () => ({
            data: { snapshot_payload: { enabledCapabilities: [] } },
            error: null,
          })),
        };
        return chain;
      }
      if (table !== "shared_context_snapshots") {
        throw new Error(`Unexpected table ${table}`);
      }
      const filters: Record<string, unknown> = {};
      let selected = "";
      const chain = {
        select(value: string) {
          selected = value;
          return chain;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        like() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          if (filters.context_hash) {
            const found = snapshots.find(
              (row) => row.context_hash === filters.context_hash,
            );
            return { data: found ? { id: found.id } : null, error: null };
          }
          const found = snapshots.at(-1);
          return {
            data: found
              ? selected === "context_payload"
                ? { context_payload: found.context_payload }
                : { id: found.id }
              : null,
            error: null,
          };
        },
        async insert(value: Record<string, unknown>) {
          snapshots.push({
            id: `context-${snapshots.length}`,
            context_hash: String(value.context_hash),
            context_payload: value.context_payload,
            source_ref: String(value.source_ref),
          });
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };

  return { client, snapshots };
}

function dependencies(
  client: unknown,
  overrides: Record<string, unknown> = {},
) {
  const unused = vi.fn();
  return {
    client,
    now: () => new Date("2026-08-13T18:01:00.000Z"),
    buildReadiness: unused,
    approveReadiness: unused,
    loadSources: unused,
    listBriefs: unused,
    saveBrief: unused,
    createBrief: unused,
    getBrief: unused,
    createDirections: unused,
    getDirections: unused,
    selectDirection: unused,
    confirmDirection: unused,
    createPlan: unused,
    getPlan: unused,
    decidePlan: unused,
    ...overrides,
  } as never;
}

describe("SiteForge guided service persistence", () => {
  it("persists a turn, resumes it in a new service instance, and deduplicates retries", async () => {
    const store = fakeClient();
    const service = createSiteForgeGuidedService(dependencies(store.client));
    const first = await service.conversation("website-1", {
      clientRequestId: "turn-1",
      expectedRevision: 0,
      field: "objective",
      answer: "Increase qualified tour requests",
      attachments: [],
    });
    expect(first.duplicate).toBe(false);
    expect(first.state.answers.objective).toBe(
      "Increase qualified tour requests",
    );
    const persistedCount = store.snapshots.length;

    const resumed = createSiteForgeGuidedService(dependencies(store.client));
    const duplicate = await resumed.conversation("website-1", {
      clientRequestId: "turn-1",
      expectedRevision: 0,
      field: "objective",
      answer: "This retry must not create another turn",
      attachments: [],
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.answers.objective).toBe(
      "Increase qualified tour requests",
    );
    expect(
      duplicate.state.turns.filter((turn) => turn.clientRequestId === "turn-1"),
    ).toHaveLength(2);
    expect(store.snapshots).toHaveLength(persistedCount);
  });

  it("rejects out-of-order answers before any durable write", async () => {
    const store = fakeClient();
    const service = createSiteForgeGuidedService(dependencies(store.client));
    const before = store.snapshots.length;
    await expect(
      service.conversation("website-1", {
        clientRequestId: "turn-out-of-order",
        expectedRevision: 0,
        field: "renterNeeds",
        answer: "Floor-plan details",
        attachments: [],
      }),
    ).rejects.toMatchObject({
      message:
        "Answer the current question before moving to another discovery topic.",
    });
    expect(store.snapshots).toHaveLength(before);
  });

  it("rejects a stale expected revision before writing", async () => {
    const store = fakeClient();
    const service = createSiteForgeGuidedService(dependencies(store.client));
    await expect(
      service.conversation("website-1", {
        clientRequestId: "turn-stale",
        expectedRevision: 7,
        field: "objective",
        answer: "Increase qualified tour requests",
        attachments: [],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      kind: "source_changed",
    });
    expect(store.snapshots).toHaveLength(1);
  });

  it("repins refreshed visual truth and checkpoints the plan before completion", async () => {
    const store = fakeClient(readyState());
    const refreshedSources = {
      onboardingSnapshotId: "snapshot-2",
      onboardingSnapshotHash: "f".repeat(64),
      brandAssetId: "brand-1",
      brandContractHash: "b".repeat(64),
    };
    const directionSet = {
      id: "directions-1",
      propertyId: "property-1",
      briefVersionId: "brief-1",
      status: "selected",
      selectedDirectionId: "conversion",
      selectionNotes: "Best fit.",
      contentHash: "d".repeat(64),
      directions: [
        {
          id: "conversion",
          name: "Conversion Clarity",
          direction: { cta: { label: "Schedule a tour" } },
        },
      ],
    };
    const service = createSiteForgeGuidedService(
      dependencies(store.client, {
        loadSources: vi.fn(async () => refreshedSources),
        buildReadiness: vi.fn(async () => ({
          id: "snapshot-2",
          status: "approved",
        })),
        listBriefs: vi.fn(async () => []),
        saveBrief: vi.fn(async () => ({
          id: "brief-1",
          version: 1,
          status: "approved",
          contentHash: "c".repeat(64),
        })),
        getDirections: vi.fn(async () => directionSet),
        createDirections: vi.fn(async () => directionSet),
        selectDirection: vi.fn(async () => directionSet),
        createPlan: vi.fn(async () => ({
          planId: "plan-1",
          planVersionId: "plan-version-1",
          revision: 1,
          status: "ready_for_review",
          contentHash: "e".repeat(64),
        })),
      }),
    );

    const result = await service.prepare(
      "website-1",
      { idempotencyKey: "prepare-request-1" },
      "user-1",
    );

    expect(result.state.sources).toEqual(refreshedSources);
    expect(result.state.prepared).toMatchObject({
      recommendedDirectionName: "Conversion Clarity",
      scoredDirections: [{ id: "conversion", name: "Conversion Clarity" }],
      planId: "plan-1",
    });
    const durableStates = store.snapshots.map(
      (row) => row.context_payload as ReturnType<typeof readyState>,
    );
    expect(
      durableStates.some(
        (state) =>
          state.preparation?.planId === "plan-1" && state.prepared === null,
      ),
    ).toBe(true);
  });
});
