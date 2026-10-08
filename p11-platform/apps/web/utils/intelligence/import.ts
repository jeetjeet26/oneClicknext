import { csvRecords } from "@/utils/analytics/import-parser";
import { batchSchema, observationSchema } from "./contracts";
export function parseObservationCsv(
  content: string,
  source: string,
  account: string,
) {
  if (Buffer.byteLength(content) > 2000000)
    throw new Error("Choose a CSV smaller than 2 MB.");
  const [header, ...rows] = csvRecords(content);
  if (!header || !rows.length) throw new Error("The CSV has no observations.");
  const keys = header.map((h) => h.trim());
  if (new Set(keys).size !== keys.length)
    throw new Error("Column names must be unique.");
  const required = ["key", "date", "metric", "value"];
  if (required.some((k) => !keys.includes(k)))
    throw new Error(
      "Use the observation template with key, date, metric and value columns.",
    );
  const parsed = rows.map((cells, i) => {
    if (cells.length !== keys.length)
      throw new Error(`Row ${i + 2} has the wrong number of columns.`);
    const r = Object.fromEntries(keys.map((k, j) => [k, cells[j].trim()]));
    if (!r.value || !/^\d+(\.\d+)?$/.test(r.value))
      throw new Error(`Row ${i + 2} requires a nonnegative numeric value.`);
    return observationSchema.parse({
      ...r,
      value: Number(r.value),
      device: r.device || "all",
      channel: r.channel || "unknown",
      floorplanId: r.floorplanId || null,
      page: r.page || null,
      variant: r.variant || null,
      experimentId: r.experimentId || null,
      reference: r.reference || "",
    });
  });
  const dates = parsed.map((r) => r.date).sort();
  return batchSchema.parse({
    provider: "reviewed_import",
    source,
    account,
    start: dates[0],
    end: dates.at(-1),
    observedAt: new Date().toISOString(),
    limitations: [
      "Staff-reviewed source export. Not a live provider connection.",
      "Metrics retain their supplied definition; no cross-system identity attribution is inferred.",
    ],
    rows: parsed,
  });
}
export const observationTemplate =
  "key,date,metric,value,channel,device,floorplanId,page,variant,experimentId,reference\r\n";
