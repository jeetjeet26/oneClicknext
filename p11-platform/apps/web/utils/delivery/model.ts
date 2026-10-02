import { outcomeRow, type OutcomeInput, type Quality } from "./contracts";
/** Deliberately null until every required observed duration is available. */
export function economics(review: Quality["assessment"]) {
  const parts = [
    review.deliveryMinutes,
    review.reviewMinutes,
    review.correctionMinutes,
  ];
  const actualMinutes = parts.every((n) => n !== null)
    ? parts.reduce<number>((a, n) => a + (n ?? 0), 0)
    : null;
  return {
    actualMinutes,
    savedMinutes:
      actualMinutes !== null && review.baselineMinutes !== null
        ? review.baselineMinutes - actualMinutes
        : null,
    costUsd: review.costUsd,
  };
}
export function qualitySummary(reviews: Quality[]) {
  // One latest assessment per work version; repeated reviews cannot inflate quality.
  const latest = new Map<string, Quality>();
  for (const r of [...reviews].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  ))
    if (!latest.has(r.work_id + ":" + r.work_revision))
      latest.set(r.work_id + ":" + r.work_revision, r);
  const rows = [...latest.values()],
    measured = rows.map((r) => economics(r.assessment));
  return {
    sample: rows.length,
    accepted: rows.filter(
      (r) =>
        r.assessment.factual && r.assessment.brand && r.assessment.complete,
    ).length,
    measuredTime: measured.filter((r) => r.savedMinutes !== null).length,
    savedMinutes: measured.some((r) => r.savedMinutes !== null)
      ? measured.reduce((n, r) => n + (r.savedMinutes ?? 0), 0)
      : null,
    knownCost: measured.filter((r) => r.costUsd !== null).length,
    costUsd: measured.some((r) => r.costUsd !== null)
      ? measured.reduce((n, r) => n + (r.costUsd ?? 0), 0)
      : null,
  };
}
export function parseOutcomeCsv(text: string): OutcomeInput[] {
  if (new TextEncoder().encode(text).length > 65536)
    throw Error("Use a file smaller than 64 KB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw Error("Check the CSV quotation marks.");
      quoted = true;
      continue;
    }
    if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
      continue;
    }
    if (closed) throw Error("Check the CSV quotation marks.");
    cell += c;
  }
  if (quoted) throw Error("A quoted CSV value is unfinished.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const header = rows.shift()?.map((x) => x.replace(/^\uFEFF/, "").trim());
  if (header?.join(",") !== "lead_id,stage,occurred_on,reference")
    throw Error(
      "Use the template headings: lead_id,stage,occurred_on,reference.",
    );
  if (!rows.length || rows.length > 100)
    throw Error("Review between 1 and 100 rows at a time.");
  const parsed = rows.map((r, i) => {
    if (r.length !== 4) throw Error(`Row ${i + 2} needs four columns.`);
    const result = outcomeRow.safeParse({
      leadId: r[0].trim(),
      stage: r[1].trim(),
      occurredOn: r[2].trim(),
      reference: r[3].trim(),
      source: "reviewed_import",
      revision: null,
      reason: "",
    });
    if (!result.success)
      throw Error(
        `Review the lead, stage, date and source reference on row ${i + 2}.`,
      );
    return result.data;
  });
  if (
    new Set(parsed.map((r) => r.leadId + ":" + r.stage)).size !== parsed.length
  )
    throw Error("Each lead and stage may appear only once.");
  return parsed;
}
