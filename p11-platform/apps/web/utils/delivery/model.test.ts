import { describe, it, expect } from "vitest";
import { economics, parseOutcomeCsv, qualitySummary } from "./model";
import { deliveryCommand, type Assessment, type Quality } from "./contracts";
const id = "ed610001-0000-4000-8000-000000000021";
const row = `${id},lease,2026-09-30,"CRM report, reviewed"`;
const csv = "lead_id,stage,occurred_on,reference\r\n";
const assessment: Assessment = {
  model: "existing-model",
  factual: true,
  brand: true,
  complete: true,
  score: 5,
  corrections: "No changes needed",
  baselineMinutes: 60,
  deliveryMinutes: 20,
  reviewMinutes: 10,
  correctionMinutes: 5,
  costUsd: null,
};
describe("reviewed outcomes", () => {
  it("reads quoted CSV references and fixes source provenance", () =>
    expect(parseOutcomeCsv(csv + row)).toEqual([
      {
        leadId: id,
        stage: "lease",
        occurredOn: "2026-09-30",
        reference: "CRM report, reviewed",
        source: "reviewed_import",
        revision: null,
        reason: "",
      },
    ]));
  it.each([
    row + "\n" + row,
    `${id},lease,2026-02-30,report`,
    `${id},lease,2026-09-30,"unfinished`,
    `${id},lease,2026-09-30,"closed"tail`,
    `${id},provider_verified,2026-09-30,report`,
  ])("rejects ambiguous or invalid rows: %s", (r) =>
    expect(() => parseOutcomeCsv(csv + r)).toThrow(),
  );
  it("retains quoted multiline evidence and escaped quotes", () =>
    expect(
      parseOutcomeCsv(
        csv + `${id},application,2026-09-30,"Reviewed \"\"monthly\"\"\nreport"`,
      )[0].reference,
    ).toBe('Reviewed "monthly"\nreport'));
  it("caps file size and row count before applying", () => {
    expect(() => parseOutcomeCsv(csv + "a".repeat(65536))).toThrow();
    expect(() =>
      parseOutcomeCsv(csv + Array.from({ length: 101 }, () => row).join("\n")),
    ).toThrow();
  });
  it("rejects a browser attempting to impersonate a provider", () =>
    expect(
      deliveryCommand.safeParse({
        requestId: id,
        expectedActorId: id,
        propertyId: id,
        input: {
          operation: "outcomes",
          rows: [
            { ...parseOutcomeCsv(csv + row)[0], source: "provider_verified" },
          ],
        },
      }).success,
    ).toBe(false));
});
describe("measured delivery economics", () => {
  it("includes review and correction effort", () =>
    expect(economics(assessment)).toEqual({
      actualMinutes: 35,
      savedMinutes: 25,
      costUsd: null,
    }));
  it("preserves negative savings and known zero cost", () =>
    expect(
      economics({ ...assessment, baselineMinutes: 10, costUsd: 0 }),
    ).toEqual({ actualMinutes: 35, savedMinutes: -25, costUsd: 0 }));
  it("does not turn missing effort or model cost into zero", () =>
    expect(economics({ ...assessment, reviewMinutes: null })).toEqual({
      actualMinutes: null,
      savedMinutes: null,
      costUsd: null,
    }));
  it("counts only the latest review of the exact work version", () => {
    const r: Quality = {
      id: "a",
      work_id: "work",
      work_revision: 1,
      title: "Work",
      evidence_id: "e",
      assessment,
      created_at: "2026-09-30T12:00:00Z",
    };
    expect(
      qualitySummary([
        r,
        {
          ...r,
          id: "b",
          created_at: "2026-09-30T13:00:00Z",
          assessment: { ...assessment, brand: false },
        },
      ]),
    ).toMatchObject({
      sample: 1,
      accepted: 0,
      savedMinutes: 25,
      knownCost: 0,
      costUsd: null,
    });
  });
});
