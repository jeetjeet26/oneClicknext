import { reportingRows } from "@/utils/analytics/report-quality";
import { periodMeasures, funnelRates, leaseAttribution, spendingRatios } from "./reporting";
import {
  ACTION_LABELS,
  PRODUCT_LABELS,
  type ProductKey,
} from "@/utils/actions/catalog";
import "server-only";
import {brainRpc,resolvePortfolioScope,requireCurrentScope} from "@/utils/community-brain/server";
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
  selectedPropertyIds?: string[],
  page = 0,
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
    properties = await brainRpc<Array<{id:string;name:string}>>("brain_list_communities",{p_actor_id:actor.id,p_capability:propertyId?'read':'portfolio'});
  }
  if(selectedPropertyIds){if(selectedPropertyIds.some(id=>!properties.some(p=>p.id===id)))throw new IntelligenceError('Selected properties are unavailable.',403);properties=properties.filter(p=>selectedPropertyIds.includes(p.id));}
  if (propertyId && !properties.some((p) => p.id === propertyId))
    throw new IntelligenceError("Property not available.", 403);
  if (propertyId) properties = properties.filter((p) => p.id === propertyId);
  if(!Number.isSafeInteger(page)||page<0)throw new IntelligenceError('Choose a valid portfolio page.',400);
  const selectedCount=properties.length;
  const communityScope=!client&&!propertyId&&properties.length?await resolvePortfolioScope(actor.id,properties.map(p=>p.id)):null;
  properties=properties.slice(page*25,(page+1)*25);
  const days = Math.floor((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
    day = (n: number) => new Date(n).toISOString().slice(0, 10),
    priorEnd = day(Date.parse(start) - 86400000),
    priorStart = day(Date.parse(start) - days * 86400000);
  const results = [];
  // Bound concurrency and aggregate only authorized property scopes.
  for (let offset = 0; offset < properties.length; offset += 5) {
    const group = await Promise.all(
      properties.slice(offset, offset + 5).map(async (p) => {
        if(communityScope)await requireCurrentScope(communityScope,p.id);
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
                "id,competitor_id,unit_type,rent_min,rent_max,last_updated_at,capture_id,bedrooms,available_count,move_in_specials",
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
        const captureIds = [...new Set((unitData.data ?? []).map(u => u.capture_id).filter((id): id is string => !!id))];
        const captures = captureIds.length ? await db.from("market_source_captures")
          .select("id,competitor_id,source_url,captured_at,effective_at,status")
          .eq("property_id", p.id).in("id", captureIds) : { data: [], error: null };
        if (captures.error) throw new IntelligenceError("Market sources could not be loaded.");
        const normalize = reportingRows;
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
          observedDays: new Set(normalize(current).map((r) => r.date)).size,
          previousObservedDays: new Set(normalize(previous).map((r) => r.date)).size,
          spend: current.length && current.length === source.currentRows.length ? report.totals.spend : null,
          clicks: report.totals.clicks,
          inquiries: funnel.inquiries,
          tours: funnel.booked,
          applications: funnel.applications,
          leases: funnel.leases,
          previous: {
            spend: report.comparison?.totals?.spend ?? null,
            clicks: normalize(previous).reduce((s, r) => s + r.clicks, 0),
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
          incompleteMarketingRows: current.length - source.currentRows.length,
          periodMeasures: periodMeasures(observations, start, end),
          stageRatios: funnelRates(funnel),
          attribution: leaseAttribution(observations, start, end),
          spending: spendingRatios(current.length ? score.spend : null, current.length === source.currentRows.length && score.observedDays === days, funnel),
          market: {
            competitors: market.data ?? [],
            units: (unitData.data ?? []).map(u => ({ ...u, evidence: (captures.data ?? []).find(c => c.id === u.capture_id && c.competitor_id === u.competitor_id) ?? null })),
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
          insights: current.length !== source.currentRows.length || previous.length !== source.previousRows.length
            ? [{ title: "Marketing measures need review", observation: "Some current or prior marketing records are incomplete.", interpretation: "Missing measures can distort trends and property comparisons.", confidence: "low" as const, targetMetric: "Data coverage", action: "Reconcile source records before drawing performance conclusions." }]
            : scoreInsights(score),
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
  if(communityScope)await requireCurrentScope(communityScope,communityScope.property_ids[0]);
  return {
    coverage:{selected:selectedCount,returned:results.length,page,nextPage:(page+1)*25<selectedCount?page+1:null},
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
