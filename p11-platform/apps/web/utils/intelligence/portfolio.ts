import {
  ACTION_LABELS,
  PRODUCT_LABELS,
  type ProductKey,
} from "@/utils/actions/catalog";
import "server-only";
import { createServiceClient } from "@/utils/supabase/admin";
import {
  portalActor,
  clientScope,
  portalRpc,
} from "@/utils/client-portal/server";
import { readMarketingFacts } from "@/utils/analytics/read-marketing-facts";
import { buildBiReport, type BiSource } from "@/utils/analytics/report-data";
import { deliveryRpc } from "@/utils/delivery/server";
import type { Funnel } from "@/utils/delivery/contracts";
import { readDocuments, IntelligenceError } from "./store";
import {
  approvedObservations,
  summarizeObservations,
  visibleFacts,
  scoreInsights,
  portfolioBenchmark,
  evaluateExperiment,
  type PropertyScore,
} from "./analysis";
import { recommendationSchema } from "./contracts";
export async function readPortfolio(
  start: string,
  end: string,
  client: boolean,
  propertyId?: string,
) {
  const actor = await portalActor(),
    db = createServiceClient();
  let scope: Awaited<ReturnType<typeof clientScope>> | null = null;
  let properties: Array<{
    id: string;
    name: string;
  }>;
  if (client) {
    scope = await clientScope(actor.id);
    properties = scope.properties;
  } else {
    const membership = await db.rpc("team_member_view", { p_id: actor.id });
    if (
      membership.error ||
      !membership.data ||
      typeof membership.data !== "object" ||
      Array.isArray(membership.data) ||
      membership.data.accessBlocked !== false
    )
      throw new IntelligenceError("Workspace access is unavailable.", 403);
    const p = await db
      .from("profiles")
      .select("org_id")
      .eq("id", actor.id)
      .single();
    if (p.error || !p.data?.org_id)
      throw new IntelligenceError("Workspace access is required.", 403);
    const r = await db
      .from("properties")
      .select("id,name")
      .eq("org_id", p.data.org_id)
      .order("name")
      .limit(101);
    if (r.error) throw new IntelligenceError("Properties could not be loaded.");
    properties = r.data ?? [];
  }
  if (propertyId && !properties.some((p) => p.id === propertyId))
    throw new IntelligenceError("Property not available.", 403);
  if (propertyId) properties = properties.filter((p) => p.id === propertyId);
  if (properties.length > 100)
    throw new IntelligenceError(
      "Select a property to keep this analysis within 100 properties.",
      422,
    );
  const days = Math.floor((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
    day = (n: number) => new Date(n).toISOString().slice(0, 10),
    priorEnd = day(Date.parse(start) - 86400000),
    priorStart = day(Date.parse(start) - days * 86400000);
  const results = [];
  // Bound concurrency and aggregate only authorized property scopes.
  for (let offset = 0; offset < properties.length; offset += 5) {
    const group = await Promise.all(
      properties.slice(offset, offset + 5).map(async (p) => {
        const [current, previous, docs, delivery, market, changes] =
          await Promise.all([
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
            readDocuments(p.id),
            client
              ? portalRpc("read_client_delivery", {
                  p_actor_id: actor.id,
                  p_property_id: p.id,
                  p_start: start,
                  p_end: end,
                })
              : deliveryRpc("read_delivery_workspace", {
                  p_actor_id: actor.id,
                  p_property_id: p.id,
                  p_input: { start, end },
                }),
            db
              .from("competitors")
              .select("id,name,website_url,last_scraped_at")
              .eq("property_id", p.id)
              .eq("is_active", true)
              .order("name")
              .limit(51),
            db
              .from("shared_action_events")
              .select("id,product,action,created_at")
              .eq("property_id", p.id)
              .eq("evidence", "server_confirmed")
              .eq("phase", "succeeded")
              .gte("created_at", start + "T00:00:00Z")
              .lt("created_at", day(Date.parse(end) + 86400000) + "T00:00:00Z")
              .order("created_at", { ascending: false })
              .limit(51),
          ]);
        if (market.error || changes.error)
          throw new IntelligenceError(
            "Market context or activity could not be loaded.",
          );
        const competitorIds = (market.data ?? []).map((c) => c.id);
        const unitData = competitorIds.length
          ? await db
              .from("competitor_units")
              .select(
                "id,competitor_id,unit_type,rent_min,rent_max,last_updated_at,capture_id",
              )
              .in("competitor_id", competitorIds)
              .not("capture_id", "is", null)
              .order("last_updated_at", { ascending: false })
              .limit(201)
          : { data: [], error: null };
        if (unitData.error)
          throw new IntelligenceError(
            "Saved market observations could not be loaded.",
          );
        const normalize = (rows: typeof current) =>
          rows.map((r) => {
            if (
              [r.impressions, r.clicks, r.spend, r.conversions].some(
                (v) => v === null,
              )
            )
              throw new IntelligenceError(
                "Some marketing measures are missing. Review the source before comparing results.",
                422,
              );
            return {
              ...r,
              impressions: Number(r.impressions),
              clicks: Number(r.clicks),
              spend: Number(r.spend),
              conversions: Number(r.conversions),
            };
          });
        const source: BiSource = {
          version: "bi-v1",
          propertyId: p.id,
          propertyName: p.name,
          filters: {
            startDate: start,
            endDate: end,
            compare: true,
            channel: null,
            account: null,
          },
          currentRows: normalize(current),
          previousRows: normalize(previous),
          previousPeriod: { start: priorStart, end: priorEnd },
        };
        const report = buildBiReport(source),
          facts = visibleFacts(docs),
          funnel = delivery.funnel as Funnel,
          prior = delivery.previousFunnel as Funnel;
        const score: PropertyScore = {
          id: p.id,
          name: p.name,
          market: facts.find((f) => f.field === "market")?.value ?? null,
          days,
          observedDays: new Set(current.map((r) => r.date)).size,
          previousObservedDays: new Set(previous.map((r) => r.date)).size,
          spend: report.totals.spend,
          clicks: report.totals.clicks,
          inquiries: funnel.inquiries,
          tours: funnel.booked,
          applications: funnel.applications,
          leases: funnel.leases,
          previous: {
            spend: report.comparison?.totals?.spend ?? null,
            clicks: previous.reduce((s, r) => s + Number(r.clicks ?? 0), 0),
            inquiries: prior.inquiries,
            tours: prior.booked,
          },
          latest:
            current
              .map((r) => r.date)
              .sort()
              .at(-1) ?? null,
        };
        const observations = approvedObservations(docs),
          diagnostics = summarizeObservations(observations, start, end).map(
            (d) => (client ? { ...d, account: "" } : d),
          );
        const recommendations = docs
          .filter(
            (d) =>
              d.kind === "recommendation" &&
              (!client ||
                ["approved", "implemented", "measured"].includes(d.status)),
          )
          .map((d) => {
            const value = recommendationSchema.parse(d.payload);
            return {
              id: d.id,
              status: d.status,
              revision: d.revision,
              title: value.title,
              rationale: value.rationale,
              targetMetric: value.targetMetric,
              confidence: value.confidence,
              expectedImpact: value.expectedImpact,
              result: value.result,
              ...(!client
                ? {
                    owner: value.owner,
                    executionType: value.executionType,
                    evidence: value.evidence,
                    basecampUrl: value.basecampUrl,
                    rollback: value.rollback,
                    releaseEvent: value.releaseEvent,
                    measurementEvent: value.measurementEvent,
                  }
                : {}),
            };
          });
        return {
          score,
          market: {
            competitors: market.data ?? [],
            units: unitData.data ?? [],
            limited:
              (market.data?.length ?? 0) > 50 ||
              (unitData.data?.length ?? 0) > 200,
            note: "Saved competitor observations; capture date and source remain visible. These are asking rents, not verified leases or market-wide averages.",
          },
          changes: {
            events: (changes.data ?? [])
              .slice(0, 50)
              .map((e) => ({
                ...e,
                action: ACTION_LABELS[e.action] ?? "Recorded property change",
                product: PRODUCT_LABELS[e.product as ProductKey] ?? "Console",
              })),
            more: (changes.data?.length ?? 0) > 50,
          },
          insights: scoreInsights(score),
          facts,
          diagnostics,
          recommendations,
          experiments: docs
            .filter(
              (d) =>
                d.kind === "experiment" &&
                ["approved", "measured"].includes(d.status),
            )
            .map((d) => ({
              id: d.id,
              title: (
                d.payload as {
                  title: string;
                }
              ).title,
              ...evaluateExperiment(d, observations),
            })),
          coverage: [
            {
              provider: "marketing",
              records: current.length,
              latest: score.latest,
              syncedAt: null,
              status: current.length
                ? "Recorded marketing observations"
                : "No marketing data in this period",
            },
            {
              provider: "leasing_outcomes",
              records: funnel.reportedRecords,
              latest: funnel.lastOutcomeUpdate?.slice(0, 10) ?? null,
              syncedAt: funnel.lastOutcomeUpdate,
              status:
                "Recorded inquiry cohorts; downstream reporting may be incomplete",
            },
            ...[
              "search_console",
              "callrail",
              "buildium",
              "reviewed_import",
            ].map((provider) => {
              const rows = observations.filter(
                (r) =>
                  r.provider === provider && r.date >= start && r.date <= end,
              );
              return {
                provider,
                records: rows.length,
                latest:
                  rows
                    .map((r) => r.date)
                    .sort()
                    .at(-1) ?? null,
                syncedAt:
                  rows
                    .map((r) => r.capturedAt)
                    .sort()
                    .at(-1) ?? null,
                status: rows.length
                  ? "Reviewed observations"
                  : "No reviewed data in this period",
              };
            }),
          ],
        };
      }),
    );
    results.push(...group);
  }
  if (!client) {
    const membership = await db.rpc("team_member_view", { p_id: actor.id });
    const current = await db
      .from("profiles")
      .select("org_id")
      .eq("id", actor.id)
      .single();
    const visible = await db
      .from("properties")
      .select("id")
      .eq("org_id", current.data?.org_id ?? "")
      .in(
        "id",
        properties.map((p) => p.id),
      );
    if (
      membership.error ||
      !membership.data ||
      typeof membership.data !== "object" ||
      Array.isArray(membership.data) ||
      membership.data.accessBlocked !== false ||
      current.error ||
      visible.error ||
      visible.data?.length !== properties.length
    )
      throw new IntelligenceError(
        "Workspace access changed. Refresh this view.",
        409,
      );
  }
  if (client) {
    const current = await clientScope(actor.id);
    if (JSON.stringify(current) !== JSON.stringify(scope))
      throw new IntelligenceError(
        "Your property access changed. Refresh this view.",
        409,
      );
  }
  return {
    start,
    end,
    priorStart,
    priorEnd,
    generatedAt: new Date().toISOString(),
    properties: results,
    benchmarks: portfolioBenchmark(results.map((r) => r.score)),
    briefing: results.flatMap((r) =>
      r.insights.map(
        (i) => `${r.score.name}: ${i.observation} ${i.interpretation}`,
      ),
    ),
    limitations: [
      "Recorded inquiry cohorts may mature after the selected period.",
      "Spend per inquiry is descriptive; people and leases are not attributed across systems without a verified identity link.",
      "Market comparisons use only the properties this account can see.",
    ],
  };
}
export type Portfolio = Awaited<ReturnType<typeof readPortfolio>>;
