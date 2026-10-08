import {
  batchSchema,
  factUsable,
  factSchema,
  experimentSchema,
  type Document,
  type Observation,
} from "./contracts";
export type RetainedObservation = Observation & {
  source: string;
  provider: string;
  account: string;
  batchId: string;
  capturedAt: string;
};
// A newer approved import replaces the same source/account/date window, including removed rows.
export function approvedObservations(docs: Document[]): RetainedObservation[] {
  const windows = new Map<string, Array<{ start: string; end: string }>>();
  const rows: RetainedObservation[] = [];
  for (const d of [...docs].sort(
    (a, b) =>
      b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id),
  )) {
    if (d.kind !== "batch" || d.status !== "approved") continue;
    const b = batchSchema.parse(d.payload);
    const sourceKey = JSON.stringify([b.provider, b.account]);
    const covered = windows.get(sourceKey) ?? [];
    for (const r of b.rows) {
      if (covered.some((w) => r.date >= w.start && r.date <= w.end)) continue;
      rows.push({
        ...r,
        source: b.source,
        provider: b.provider,
        account: b.account,
        batchId: d.id,
        capturedAt: b.observedAt,
      });
    }
    windows.set(sourceKey, [...covered, { start: b.start, end: b.end }]);
  }
  return rows;
}
export function summarizeObservations(
  rows: RetainedObservation[],
  start: string,
  end: string,
) {
  const grouped = new Map<string, RetainedObservation[]>();
  for (const r of rows.filter(
    (r) => r.date >= start && r.date <= end && r.variant === null,
  )) {
    // Sources and channels are separate observations, never silently added together.
    const key = JSON.stringify([
      r.provider,
      r.account,
      r.metric,
      r.channel,
      r.device,
      r.floorplanId,
      r.page,
    ]);
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }
  return [...grouped].map(([key, rs]) => {
    const metric = rs[0].metric;
    const snapshot = [
      "available_units",
      "market_rent",
      "active_leases",
    ].includes(metric);
    const latest = rs
      .map((r) => r.date)
      .sort()
      .at(-1)!;
    const used = snapshot ? rs.filter((r) => r.date === latest) : rs;
    return {
      key,
      metric,
      channel: rs[0].channel,
      account: rs[0].account,
      provider: rs[0].provider,
      device: rs[0].device,
      floorplanId: rs[0].floorplanId,
      page: rs[0].page,
      value:
        metric === "market_rent"
          ? used.reduce((s, r) => s + r.value, 0) / used.length
          : used.reduce((s, r) => s + r.value, 0),
      records: used.length,
      latest,
      snapshot,
      evidence: [...new Set(used.map((r) => r.batchId))],
      sources: [...new Set(used.map((r) => r.source))],
    };
  });
}
export type PropertyScore = {
  id: string;
  name: string;
  market: string | null;
  days: number;
  observedDays: number;
  previousObservedDays: number;
  spend: number | null;
  clicks: number;
  inquiries: number;
  tours: number;
  applications: number;
  leases: number;
  previous: {
    spend: number | null;
    clicks: number;
    inquiries: number;
    tours: number;
  };
  latest: string | null;
};
export function scoreInsights(s: PropertyScore) {
  const out: Array<{
    title: string;
    observation: string;
    interpretation: string;
    confidence: "low" | "medium";
    targetMetric: string;
    action: string;
  }> = [];
  const pct = (n: number, p: number) =>
    p > 0 ? Math.round(((n - p) / p) * 100) : null;
  const clicks = pct(s.clicks, s.previous.clicks),
    tours = pct(s.tours, s.previous.tours);
  if (s.observedDays < s.days || s.previousObservedDays < s.days)
    out.push({
      title: "Reporting coverage is incomplete",
      observation: `Marketing records cover ${s.observedDays} of ${s.days} requested days; the prior period covers ${s.previousObservedDays} of ${s.days}.`,
      interpretation:
        "Missing days can distort comparisons; absence of rows does not prove zero activity.",
      confidence: "low",
      targetMetric: "Data coverage",
      action: "Reconcile the missing source dates before changing marketing.",
    });
  if (clicks !== null && tours !== null && clicks > 10 && tours < -10)
    out.push({
      title: "More clicks, fewer recorded tours",
      observation: `Clicks changed ${clicks}%; recorded tours changed ${tours}%.`,
      interpretation:
        "These are concurrent changes, not proof that the website caused the decline. Review source mix, inventory and follow-up.",
      confidence: s.observedDays === s.days ? "medium" : "low",
      targetMetric: "Tour conversion",
      action:
        "Review the mobile inquiry path and source coverage, then define a measured test.",
    });
  if (s.inquiries > 0 && s.tours === 0)
    out.push({
      title: "Inquiries have no recorded tours",
      observation: `${s.inquiries} inquiries and no recorded tours in the selected inquiry cohort.`,
      interpretation:
        "Tours may be unreported or may occur later. This is not proof that none happened.",
      confidence: "low",
      targetMetric: "Recorded tour outcomes",
      action: "Reconcile tour outcomes with the leasing team.",
    });
  return out;
}
export function portfolioBenchmark(scores: PropertyScore[]) {
  return scores.map((s) => {
    const peers = scores.filter(
      (p) =>
        p.id !== s.id &&
        s.market !== null &&
        p.market === s.market &&
        p.observedDays === p.days &&
        p.inquiries >= 10 &&
        p.spend !== null,
    );
    const eligible =
      s.observedDays === s.days && s.inquiries >= 10 && s.spend !== null;
    const values = peers
      .map((p) => p.spend! / p.inquiries)
      .sort((a, b) => a - b);
    return {
      propertyId: s.id,
      metric: "Spend per recorded inquiry",
      peerCount: peers.length,
      value:
        eligible && values.length >= 3
          ? values.length % 2
            ? values[Math.floor(values.length / 2)]
            : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
          : null,
      note: "Same-market properties visible to this account, full marketing-date coverage and at least 10 recorded inquiries. Descriptive comparison, not attributed cost per lead.",
    };
  });
}
// Wilson score intervals remain conservative at zero or complete conversion.
function wilson(successes: number, n: number): [number, number] {
  const z = 1.959963984540054,
    p = successes / n,
    divisor = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / divisor;
  const radius =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / divisor;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
export function evaluateExperiment(
  doc: Document,
  rows: RetainedObservation[],
  today = new Date().toISOString().slice(0, 10),
): ExperimentEvaluation {
  // Measurement decisions are immutable snapshots; later source corrections require a new plan.
  if (doc.status === "measured") {
    const retained = (doc.payload as { evaluation?: ExperimentEvaluation })
      .evaluation;
    if (retained) return retained;
  }
  const plan = experimentSchema.parse(doc.payload);
  const selected = rows.filter(
    (r) =>
      r.experimentId === doc.id &&
      r.date >= plan.start &&
      r.date <= plan.end &&
      ["sessions", plan.metric].includes(r.metric),
  );
  const sourceCount = new Set(
    selected.map((r) => JSON.stringify([r.provider, r.account])),
  ).size;
  const arm = (variant: "control" | "treatment") => {
    const rs = selected.filter((r) => r.variant === variant);
    return {
      sessions: rs
        .filter((r) => r.metric === "sessions")
        .reduce((s, r) => s + r.value, 0),
      conversions: rs
        .filter((r) => r.metric === plan.metric)
        .reduce((s, r) => s + r.value, 0),
    };
  };
  const control = arm("control"),
    treatment = arm("treatment");
  const validCounts =
    selected.every((r) => Number.isInteger(r.value)) &&
    selected.every(
      (r) =>
        r.variant !== null &&
        r.device === "all" &&
        r.channel === "all" &&
        r.page === null &&
        r.floorplanId === null,
    );
  const identities = selected.map((r) =>
    [r.date, r.variant, r.metric].join(":"),
  );
  const pairs = new Map<string, Set<string>>();
  for (const r of selected) {
    const key = [r.date, r.variant].join(":");
    const metrics = pairs.get(key) ?? new Set<string>();
    metrics.add(r.metric);
    pairs.set(key, metrics);
  }
  const completePairs =
    pairs.size > 0 &&
    [...pairs.values()].every((v) => v.has("sessions") && v.has(plan.metric)) &&
    new Set(identities).size === identities.length;
  const ready =
    ["approved", "measured"].includes(doc.status) &&
    today > plan.end &&
    sourceCount === 1 &&
    validCounts &&
    completePairs &&
    [control, treatment].every(
      (a) => a.sessions >= plan.minimumPerArm && a.conversions <= a.sessions,
    );
  const p0 = control.sessions ? control.conversions / control.sessions : null,
    p1 = treatment.sessions ? treatment.conversions / treatment.sessions : null;
  const difference = p0 !== null && p1 !== null ? p1 - p0 : null;
  const c = ready ? wilson(control.conversions, control.sessions) : null,
    t = ready ? wilson(treatment.conversions, treatment.sessions) : null;
  // Newcombe's difference interval uses the independent Wilson bounds for each arm.
  const interval =
    ready && c && t
      ? [
          difference! - Math.sqrt((p1! - t[0]) ** 2 + (c[1] - p0!) ** 2),
          difference! + Math.sqrt((t[1] - p1!) ** 2 + (p0! - c[0]) ** 2),
        ]
      : null;
  return {
    control,
    treatment,
    difference,
    interval,
    ready,
    result: !ready
      ? "Insufficient or conflicting data, or measurement period still open"
      : interval![0] > plan.minimumEffect
        ? "Positive measured difference; review guardrails"
        : interval![1] < -plan.minimumEffect
          ? "Negative measured difference; review rollback"
          : "No clear difference at the predeclared threshold",
    limitations:
      "Approximate 95% interval for independent randomized sessions. One source account; one aggregate row per arm/date/metric, with explicit zero conversions. Assignment, consent, guardrails and conflicting changes require human verification. No automatic winner or rollout.",
    evidence: [...new Set(selected.map((r) => r.batchId))],
  };
}
export type ExperimentEvaluation = {
  control: { sessions: number; conversions: number };
  treatment: { sessions: number; conversions: number };
  difference: number | null;
  interval: number[] | null;
  ready: boolean;
  result: string;
  limitations: string;
  evidence: string[];
};
export function visibleFacts(docs: Document[]) {
  return docs
    .filter((d) => d.kind === "fact" && factUsable(d, "portal"))
    .map((d) => ({ id: d.id, ...factSchema.parse(d.payload) }));
}
