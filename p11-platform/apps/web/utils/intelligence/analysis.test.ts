import { describe, it, expect } from "vitest";
import {
  factUsable,
  factSchema,
  batchSchema,
  type Document,
} from "./contracts";
import {
  approvedObservations,
  summarizeObservations,
  portfolioBenchmark,
  evaluateExperiment,
  scoreInsights,
  type PropertyScore,
} from "./analysis";
import { parseObservationCsv } from "./import";
import { answerPortfolioQuestion } from "./questions";
import type { Portfolio } from "./portfolio";
const document = (
  payload: unknown,
  kind: Document["kind"] = "fact",
  overrides: Partial<Document> = {},
): Document => ({
  id: "11111111-1111-4111-8111-111111111111",
  property_id: "22222222-2222-4222-8222-222222222222",
  kind,
  key: "test",
  payload,
  status: "approved",
  revision: 1,
  locked: false,
  updated_at: "2026-10-07T12:00:00Z",
  actor_id: "actor",
  ...overrides,
});
const fact = {
  field: "short_description",
  value: "Saved description",
  source: "Client-approved brief",
  sourceUrl: "",
  observedAt: "2026-10-01",
  effectiveFrom: null,
  effectiveTo: null,
  reviewAfter: "2026-11-01",
  confidence: null,
  origin: "client",
  visibility: "public",
};
const batch = (value = 10) =>
  batchSchema.parse({
    provider: "reviewed_import",
    source: "Verified CSV",
    account: "web",
    start: "2026-10-01",
    end: "2026-10-01",
    observedAt: "2026-10-02T00:00:00Z",
    limitations: [],
    rows: [{ key: "day-one", date: "2026-10-01", metric: "sessions", value }],
  });
describe("property intelligence boundaries", () => {
  it("excludes drafts, private, future and expired facts from generation", () => {
    for (const payload of [
      { ...fact, visibility: "internal" },
      { ...fact, reviewAfter: "2026-10-06" },
      { ...fact, effectiveFrom: "2026-10-09" },
      { ...fact, effectiveTo: "2026-10-06" },
    ])
      expect(factUsable(document(payload), "public", "2026-10-07")).toBe(false);
    expect(
      factUsable(
        document(fact, "fact", { status: "draft" }),
        "public",
        "2026-10-07",
      ),
    ).toBe(false);
    expect(factUsable(document(fact), "public", "2026-10-07")).toBe(true);
  });
  it("keeps portal-only facts out of websites", () => {
    expect(
      factUsable(
        document({ ...fact, visibility: "portal" }),
        "public",
        "2026-10-07",
      ),
    ).toBe(false);
    expect(
      factUsable(
        document({ ...fact, visibility: "portal" }),
        "portal",
        "2026-10-07",
      ),
    ).toBe(true);
  });
  it("rejects invalid conversion links and backwards effective dates", () => {
    expect(
      factSchema.safeParse({
        ...fact,
        field: "tour_url",
        value: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      factSchema.safeParse({
        ...fact,
        effectiveFrom: "2026-11-01",
        effectiveTo: "2026-10-01",
      }).success,
    ).toBe(false);
  });
  it("latest approved source correction wins without double counting", () => {
    const rs = approvedObservations([
      document(batch(10), "batch", { updated_at: "2026-10-02T00:00:00Z" }),
      document(batch(12), "batch"),
    ]);
    expect(rs).toHaveLength(1);
    expect(summarizeObservations(rs, "2026-10-01", "2026-10-01")[0].value).toBe(
      12,
    );
  });
  it("does not include draft imports or experiment arms in ordinary totals", () => {
    const b = batch();
    b.rows[0].variant = "control";
    expect(
      approvedObservations([document(b, "batch", { status: "draft" })]),
    ).toHaveLength(0);
    expect(
      summarizeObservations(
        approvedObservations([document(b, "batch")]),
        b.start,
        b.end,
      ),
    ).toHaveLength(0);
  });
  it("validates complete import rows and refuses to turn missing counts into zero", () => {
    expect(() =>
      parseObservationCsv(
        "key,date,metric,value\na,2026-10-01,sessions,",
        "GA4",
        "one",
      ),
    ).toThrow("numeric");
    expect(() =>
      parseObservationCsv(
        "key,date,metric,value\na,2026-10-01,sessions,5\na,2026-10-01,sessions,9",
        "GA4",
        "one",
      ),
    ).toThrow("unique");
    expect(
      parseObservationCsv(
        "key,date,metric,value,device\na,2026-10-01,sessions,0,mobile",
        "GA4",
        "one",
      ).rows[0].value,
    ).toBe(0);
  });
  it("does not infer a causal website failure from concurrent metric changes", () => {
    const s = {
      name: "Test",
      days: 30,
      observedDays: 30,
      previousObservedDays: 30,
      clicks: 120,
      inquiries: 40,
      tours: 8,
      previous: { clicks: 100, tours: 10 },
    } as PropertyScore;
    expect(scoreInsights(s)[0].interpretation).toContain("not proof");
  });
  it("does not benchmark across markets or fewer than three eligible peers", () => {
    const s = {
      id: "a",
      market: "Austin",
      days: 30,
      observedDays: 30,
      previousObservedDays: 30,
      inquiries: 20,
      spend: 200,
    } as PropertyScore;
    expect(
      portfolioBenchmark([s, { ...s, id: "b", market: "Dallas" }])[0].value,
    ).toBeNull();
    expect(
      portfolioBenchmark([s, ...["b", "c", "d"].map((id) => ({ ...s, id }))])[0]
        .value,
    ).toBe(10);
  });
  it("withholds experiment conclusions before the preregistered window closes", () => {
    const plan = {
      title: "Test",
      hypothesis: "A clearer CTA increases completions",
      metric: "tour_completions",
      denominator: "sessions",
      assignment: "randomized",
      assignmentReference: "Assigned by experiment tool",
      start: "2026-10-01",
      end: "2026-10-30",
      minimumPerArm: 30,
      minimumEffect: 0.02,
      guardrail: "Stop if errors increase",
      releaseEvent: "33333333-3333-4333-8333-333333333333",
      confounders: "",
      notes: "",
    };
    expect(
      evaluateExperiment(document(plan, "experiment"), [], "2026-10-07").ready,
    ).toBe(false);
  });
  it("refuses budget forecasts and ambiguous relative dates", () => {
    const data = {
      properties: [],
      start: "2026-10-01",
      end: "2026-10-07",
    } as unknown as Portfolio;
    expect(answerPortfolioQuestion("Move $20k of budget", data).supported).toBe(
      false,
    );
    expect(answerPortfolioQuestion("Leads last month", data).supported).toBe(
      false,
    );
  });
});

describe("measurement integrity", () => {
  const plan = {
    title: "Measured test",
    hypothesis: "Clearer action increases completion",
    metric: "tour_completions",
    denominator: "sessions",
    assignment: "randomized",
    assignmentReference: "Recorded random session allocation",
    start: "2026-09-01",
    end: "2026-09-30",
    minimumPerArm: 30,
    minimumEffect: 0.02,
    guardrail: "Review errors and call quality",
    releaseEvent: "33333333-3333-4333-8333-333333333333",
    confounders: "",
    notes: "",
  };
  const experiment = document(plan, "experiment");
  const observations = (conversions = 0) =>
    approvedObservations([
      document(
        batchSchema.parse({
          ...batch(),
          start: plan.start,
          end: plan.end,
          rows: ["control", "treatment"].flatMap((variant) => [
            {
              key: variant + "-sessions",
              date: plan.start,
              metric: "sessions",
              value: 100,
              variant,
              experimentId: experiment.id,
              channel: "all",
            },
            {
              key: variant + "-conversions",
              date: plan.start,
              metric: plan.metric,
              value: conversions,
              variant,
              experimentId: experiment.id,
              channel: "all",
            },
          ]),
        }),
        "batch",
      ),
    ]);
  it("removes superseded observations, including empty correction windows", () => {
    const old = document(batch(), "batch", {
      updated_at: "2026-10-01T00:00:00Z",
    });
    const correction = document({ ...batch(), rows: [] }, "batch");
    expect(approvedObservations([old, correction])).toEqual([]);
  });
  it("keeps overlapping providers and channels separate", () => {
    const rows = approvedObservations([
      document(batch(), "batch"),
      document({ ...batch(20), account: "second" }, "batch", { id: "other" }),
    ]);
    expect(
      summarizeObservations(rows, "2026-10-01", "2026-10-01")
        .map((r) => r.value)
        .sort(),
    ).toEqual([10, 20]);
  });
  it("does not report certainty for zero conversions", () => {
    const result = evaluateExperiment(experiment, observations(), "2026-10-07");
    expect(result.ready).toBe(true);
    expect(result.interval![0]).toBeLessThan(0);
    expect(result.interval![1]).toBeGreaterThan(0);
    expect(result.result).toContain("No clear difference");
  });
  it("requires explicit conversion counts and one aggregate source", () => {
    const rows = observations(10);
    expect(
      evaluateExperiment(
        experiment,
        rows.filter((r) => !r.key.includes("conversions")),
      ).ready,
    ).toBe(false);
    expect(
      evaluateExperiment(experiment, [
        ...rows,
        { ...rows[0], account: "other", key: "other" },
      ]).ready,
    ).toBe(false);
    expect(
      evaluateExperiment(experiment, [
        ...rows,
        { ...rows[0], key: "duplicate" },
      ]).ready,
    ).toBe(false);
    expect(
      evaluateExperiment(
        experiment,
        rows.map((r) => ({ ...r, value: r.value + 0.5 })),
      ).ready,
    ).toBe(false);
    expect(
      evaluateExperiment({ ...experiment, status: "withdrawn" }, rows).ready,
    ).toBe(false);
  });
  it("retains measured decisions when later source observations change", () => {
    const evaluation = evaluateExperiment(experiment, observations(10));
    expect(
      evaluateExperiment(
        { ...experiment, status: "measured", payload: { ...plan, evaluation } },
        observations(50),
      ),
    ).toEqual(evaluation);
  });
});
