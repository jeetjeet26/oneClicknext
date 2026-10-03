import type { Funnel, Goal, ReportEvidence } from "@/utils/delivery/contracts";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/admin";
import { InventoryError } from "@/utils/knowledge/inventory";
import { readMarketingFacts } from "@/utils/analytics/read-marketing-facts";
import { buildBiReport, type BiSource } from "@/utils/analytics/report-data";
import type { PortalScope, PortalData, ClientReport } from "./contracts";
export { InventoryError as PortalError };
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function portalActor() {
  const {
    data: { user },
    error,
  } = await (await createClient()).auth.getUser();
  if (error || !user)
    throw new InventoryError("Please sign in to continue.", 401);
  return user;
}
export async function portalRpc(name: string, args: Record<string, unknown>) {
  const db = createServiceClient() as unknown as {
    rpc: (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
  };
  const { data, error } = await db.rpc(name, args);
  if (error || !data)
    throw new InventoryError(
      "We couldn’t confirm this request. Refresh and try again.",
    );
  const messages: Record<string, string> = {
    forbidden: "This view is not available to your account.",
    recipient_required:
      "Sign in with the verified email address this invitation was created for.",
    unavailable:
      "This invitation is no longer available. Please ask your P11 team for a new link.",
    account_conflict:
      "Use a separate client account. This account already has workspace access.",
    already_exists:
      "This client already has access or a pending invitation. Review their entry below.",
    changed:
      "Access changed since you opened this page. Refresh before saving.",
    invalid_properties: "Choose properties that belong to your workspace.",
    request_conflict:
      "This request has already been used for a different decision.",
  };
  if (!["ready", "saved", "replayed", "joined"].includes(String(data.state)))
    throw new InventoryError(
      messages[String(data.state)] ||
        "Please review the details and try again.",
      ["forbidden", "recipient_required"].includes(String(data.state))
        ? 403
        : 409,
    );
  return data;
}
export async function clientScope(actor: string) {
  return (await portalRpc("read_client_portal_scope", {
    p_actor_id: actor,
  })) as unknown as PortalScope;
}
export async function clientLumaProperties(scope: PortalScope) {
  if (!scope.properties.length) return [];
  const { data, error } = await createServiceClient()
    .from("lumaleasing_config")
    .select("property_id,is_active")
    .in(
      "property_id",
      scope.properties.map((p) => p.id),
    );
  if (error || !data)
    throw new InventoryError(
      "Your chatbot access could not be loaded. Please try again.",
    );
  return scope.properties.flatMap((p) => {
    const config = data.find((c) => c.property_id === p.id);
    return config ? [{ ...p, active: config.is_active === true }] : [];
  });
}
export async function decideAccess(
  actor: string,
  command: Record<string, unknown>,
) {
  const { requestId, ...input } = command,
    token =
      command.operation === "invite" ? randomBytes(32).toString("hex") : null;
  const result = await portalRpc("decide_client_access", {
    p_id: requestId,
    p_actor_id: actor,
    p_input: input,
    ...(token ? { p_token_hash: tokenHash(token) } : {}),
  });
  return result.state === "saved" && token
    ? { ...result, invitationToken: token }
    : result;
}
export async function readPortal(
  actor: string,
  query: { propertyId?: string; days: number; reportOffset: number },
): Promise<PortalData> {
  const scope = await clientScope(actor);
  if (
    query.propertyId &&
    !scope.properties.some((p) => p.id === query.propertyId)
  )
    throw new InventoryError(
      "This property is not available to your account.",
      403,
    );
  const selected = scope.properties.filter(
    (p) => !query.propertyId || p.id === query.propertyId,
  );
  const end = new Date().toISOString().slice(0, 10);
  const day = (value: number) => new Date(value).toISOString().slice(0, 10);
  const start = day(Date.parse(end) - (query.days - 1) * 86400000);
  const priorEnd = day(Date.parse(start) - 86400000);
  const priorStart = day(Date.parse(start) - query.days * 86400000);
  const db = createServiceClient();
  const [sources, published, chatbotProperties] = await Promise.all([
    Promise.all(
      selected.map(async (p) => {
        const [current, previous, delivery] = await Promise.all([
          readMarketingFacts(db, {
            propertyId: p.id,
            startDate: start,
            endDate: end,
          }),
          readMarketingFacts(db, {
            propertyId: p.id,
            startDate: priorStart,
            endDate: priorEnd,
          }),
          portalRpc("read_client_delivery", {
            p_actor_id: actor,
            p_property_id: p.id,
            p_start: start,
            p_end: end,
          }),
        ]);
        if (delivery.propertyId !== p.id)
          throw new InventoryError(
            "Your results could not be matched to this property.",
          );
        return {
          property: p,
          current,
          previous,
          delivery: delivery as unknown as {
            funnel: Funnel;
            previousFunnel: Funnel;
            goals: Goal[];
          },
        };
      }),
    ),
    portalRpc("read_published_delivery_reports", {
      p_actor_id: actor,
      p_property_id: query.propertyId ?? null,
      p_offset: query.reportOffset,
    }),
    clientLumaProperties(scope),
  ]);
  const normalize = (rows: Awaited<ReturnType<typeof readMarketingFacts>>) =>
    rows.map((f) => ({
      ...f,
      impressions: Number(f.impressions ?? 0),
      clicks: Number(f.clicks ?? 0),
      conversions: Number(f.conversions ?? 0),
      spend: Number(f.spend ?? 0),
    }));
  const facts = sources.flatMap((s) => s.current);
  const source: BiSource = {
    version: "bi-v1",
    propertyId: query.propertyId ?? "portfolio",
    propertyName: "Your properties",
    filters: {
      startDate: start,
      endDate: end,
      compare: true,
      channel: null,
      account: null,
    },
    currentRows: normalize(facts),
    previousRows: normalize(sources.flatMap((s) => s.previous)),
    previousPeriod: { start: priorStart, end: priorEnd },
  };
  const report = buildBiReport(source);
  const sumFunnel = (key: "funnel" | "previousFunnel"): Funnel => {
    const values = sources.map((s) => s.delivery[key]);
    const result: Funnel = {
      definition: "inquiry-cohort-v1",
      start: key === "funnel" ? start : priorStart,
      end: key === "funnel" ? end : priorEnd,
      inquiries: 0,
      booked: 0,
      attended: 0,
      applications: 0,
      leases: 0,
      sources: [],
      reportedRecords: 0,
      lastOutcomeUpdate: null,
      limitations:
        "Recorded inquiry cohorts; cross-system duplicate people and unreported outcomes may remain.",
    };
    for (const f of values) {
      for (const metric of [
        "inquiries",
        "booked",
        "attended",
        "applications",
        "leases",
        "reportedRecords",
      ] as const)
        result[metric] += f[metric];
      if (
        f.lastOutcomeUpdate &&
        (!result.lastOutcomeUpdate ||
          f.lastOutcomeUpdate > result.lastOutcomeUpdate)
      )
        result.lastOutcomeUpdate = f.lastOutcomeUpdate;
      for (const row of f.sources) {
        let entry = result.sources.find((s) => s.source === row.source);
        if (!entry) {
          entry = {
            source: row.source,
            inquiries: 0,
            booked: 0,
            attended: 0,
            applications: 0,
            leases: 0,
          };
          result.sources.push(entry);
        }
        for (const metric of [
          "inquiries",
          "booked",
          "attended",
          "applications",
          "leases",
        ] as const)
          entry[metric] += row[metric];
      }
    }
    return result;
  };
  const saved = published.reports as {
    id: string;
    label: string;
    property_name: string;
    published_at: string;
    source: BiSource;
    summary: string;
    next_steps: string;
    evidence: ReportEvidence;
  }[];
  const reports: ClientReport[] = saved.slice(0, 20).map((row) => {
    const built = buildBiReport(row.source);
    return {
      id: row.id,
      name: row.label ?? "Monthly marketing report",
      propertyName: row.property_name,
      createdAt: row.published_at,
      start: built.dateRange.start,
      end: built.dateRange.end,
      totals: built.totals,
      records: built.coverage.records,
      summary: row.summary,
      nextSteps: row.next_steps,
      evidence: row.evidence,
      comparison: built.comparison,
      coverage: {
        ...built.coverage,
        sources: built.coverage.sources.map((s) => ({
          channel: s.channel,
          records: s.records,
          days: s.days,
          firstDate: s.firstDate,
          lastDate: s.lastDate,
          currencyKnown: s.currencyKnown,
        })),
      },
    };
  });
  const current = await clientScope(actor);
  if (
    current.orgId !== scope.orgId ||
    current.revision !== scope.revision ||
    JSON.stringify(current.properties) !== JSON.stringify(scope.properties)
  )
    throw new InventoryError(
      "Your property access changed. Refresh to see the latest view.",
      409,
    );
  const funnel = sumFunnel("funnel");
  return {
    name: scope.name,
    hasLumaLeasing: chatbotProperties.length > 0,
    properties: scope.properties,
    selectedProperty: query.propertyId ?? null,
    period: { start, end, days: query.days },
    inquiries: funnel.inquiries,
    tours: funnel.booked,
    marketing: report.totals,
    hasMarketingData: facts.length > 0,
    channels: report.channels,
    trend: report.timeSeries.map((d) => ({
      date: d.date,
      impressions: d.impressions,
      clicks: d.clicks,
      spend: d.spend,
    })),
    reports,
    nextReportOffset: saved.length > 20 ? query.reportOffset + 20 : null,
    updatedAt: new Date().toISOString(),
    funnel,
    previousFunnel: sumFunnel("previousFunnel"),
    comparison: report.comparison,
    coverage: sources.map((s) => ({
      propertyId: s.property.id,
      propertyName: s.property.name,
      observedDays: new Set(s.current.map((r) => r.date)).size,
      requestedDays: query.days,
      latestDate:
        s.current
          .map((r) => r.date)
          .sort()
          .at(-1) ?? null,
      records: s.current.length,
    })),
    goals: sources.flatMap((s) =>
      s.delivery.goals.map((g) => ({ ...g, propertyName: s.property.name })),
    ),
  };
}
