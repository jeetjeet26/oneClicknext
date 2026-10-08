import { createHash } from "node:crypto";
import { z } from "zod";
import {
  batchSchema,
  observationSchema,
  type Batch,
  type Observation,
} from "./contracts";
export const providerNames = {
  search_console: "Google Search Console",
  callrail: "CallRail",
  buildium: "Buildium",
} as const;
export type Provider = keyof typeof providerNames;
// CallRail and Buildium are deferred; keep their adapters for future use.
export const enabledProviders = ["search_console"] as const;
const binding = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("search_console"),
    propertyId: z.string().uuid(),
    siteUrl: z.string().min(1),
    accessToken: z.string().min(1),
  }),
  z.object({
    provider: z.literal("callrail"),
    propertyId: z.string().uuid(),
    accountId: z.string().regex(/^[A-Za-z0-9]+$/),
    companyId: z.string().regex(/^[A-Za-z0-9]+$/),
    apiKey: z.string().min(1),
  }),
  z.object({
    provider: z.literal("buildium"),
    propertyId: z.string().uuid(),
    rentalPropertyId: z.number().int().positive(),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    sandbox: z.boolean().default(false),
  }),
]);
export type Binding = z.infer<typeof binding>;
export function providerBinding(
  propertyId: string,
  provider: Provider,
): Binding | null {
  let list: unknown;
  try {
    list = JSON.parse(process.env.P11_INTELLIGENCE_CONNECTIONS || "[]");
  } catch {
    throw new Error("Data connection configuration is invalid.");
  }
  const parsed = z.array(binding).max(200).parse(list);
  const matches = parsed.filter(
    (b) => b.propertyId === propertyId && b.provider === provider,
  );
  if (matches.length > 1) throw new Error("Duplicate property connection.");
  return matches[0] ?? null;
}
export function connectionSummary(propertyId: string) {
  return enabledProviders.map((id) => ({
    id,
    name: providerNames[id],
    configured: !!providerBinding(propertyId, id as Provider),
  }));
}
const record = z.record(z.string(), z.unknown());
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function retrieveProvider(
  config: Binding,
  start: string,
  end: string,
  request: typeof fetch = fetch,
): Promise<Batch> {
  const now = new Date().toISOString(),
    rows: Observation[] = [];
  const get = async (url: string, init: RequestInit = {}) => {
    const r = await request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok)
      throw new Error(
        `The source returned ${r.status}. No observations were saved.`,
      );
    const body = await r.text();
    if (body.length > 8000000)
      throw new Error("The source response is too large. Narrow the dates.");
    return JSON.parse(body) as unknown;
  };
  const add = (input: unknown) => {
    rows.push(observationSchema.parse(input));
    if (rows.length > 5000)
      throw new Error(
        "More than 5,000 observations. Narrow the dates; no partial import was saved.",
      );
  };
  let account = "",
    limitations: string[] = [];
  if (config.provider === "search_console") {
    account = config.siteUrl;
    limitations = [
      "Google returns available top rows and may omit anonymized search data. These are search-result interactions, not website sessions. Dates use Pacific time.",
    ];
    for (let offset = 0; offset <= 5000; offset += 1000) {
      const result = z
        .object({
          rows: z
            .array(
              z.object({
                keys: z.array(z.string()).length(3),
                clicks: z.number().nonnegative(),
                impressions: z.number().nonnegative(),
              }),
            )
            .default([]),
        })
        .parse(
          await get(
            `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.siteUrl)}/searchAnalytics/query`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                startDate: start,
                endDate: end,
                dimensions: ["date", "device", "page"],
                dataState: "final",
                type: "web",
                rowLimit: 1000,
                startRow: offset,
              }),
            },
          ),
        );
      for (const r of result.rows) {
        for (const [metric, value] of [
          ["search_clicks", r.clicks],
          ["search_impressions", r.impressions],
        ] as const)
          add({
            key: hash([r.keys, metric]),
            date: r.keys[0],
            device: r.keys[1].toLowerCase(),
            page: r.keys[2],
            channel: "organic_search",
            metric,
            value,
          });
      }
      if (result.rows.length < 1000) break;
    }
  } else if (config.provider === "callrail") {
    account = config.companyId;
    limitations = [
      "Calls are not deduplicated people or verified leases. Qualification is the source’s reported good-lead status. Dates use the configured CallRail account timezone.",
    ];
    const seen = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      const url = new URL(
        `https://api.callrail.com/v3/a/${config.accountId}/calls.json`,
      );
      url.search = new URLSearchParams({
        company_id: config.companyId,
        start_date: start,
        end_date: end,
        page: String(page),
        per_page: "250",
        fields: "source,lead_status,company_id",
        direction: "inbound",
      }).toString();
      const result = z
        .object({
          total_pages: z.number().int().nonnegative(),
          calls: z.array(
            z.object({
              id: z.string(),
              start_time: z.iso.datetime({ offset: true }),
              answered: z.boolean(),
              company_id: z.string().optional(),
              source: z.string().nullable().optional(),
              lead_status: z.string().nullable().optional(),
            }),
          ),
        })
        .parse(
          await get(url.href, {
            headers: { Authorization: `Token token="${config.apiKey}"` },
          }),
        );
      if (result.total_pages > 20)
        throw new Error("Too many calls. Narrow the dates.");
      for (const c of result.calls) {
        if (c.company_id && c.company_id !== config.companyId)
          throw new Error("A call belongs to another company.");
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const date = c.start_time.slice(0, 10);
        for (const [metric, value] of [
          ["calls", 1],
          ["answered_calls", Number(c.answered)],
          ["qualified_calls", Number(c.lead_status === "good_lead")],
        ] as const)
          add({
            key: hash([c.id, metric]),
            date,
            channel: c.source ?? "unknown",
            metric,
            value,
          });
      }
      if (page >= result.total_pages) break;
    }
  } else {
    account = String(config.rentalPropertyId);
    limitations = [
      "Point-in-time Buildium inventory and active lease records. Active leases do not prove a signature date and are not attributed to leads. Market rent is an asking-rent snapshot, not collected rent.",
    ];
    const today = now.slice(0, 10);
    start = today;
    end = today;
    const headers = {
      "x-buildium-client-id": config.clientId,
      "x-buildium-client-secret": config.clientSecret,
    };
    const base = config.sandbox
      ? "https://apisandbox.buildium.com"
      : "https://api.buildium.com";
    for (const path of ["rentals/units", "leases"]) {
      for (let offset = 0; offset <= 5000; offset += 1000) {
        const url = new URL(`${base}/v1/${path}`);
        url.search = new URLSearchParams({
          propertyids: String(config.rentalPropertyId),
          limit: "1000",
          offset: String(offset),
        }).toString();
        const data = z.array(record).parse(await get(url.href, { headers }));
        for (const r of data) {
          if (Number(r.PropertyId) !== config.rentalPropertyId)
            throw new Error(
              "The property management source returned another property.",
            );
          const id = String(r.Id);
          if (path === "rentals/units") {
            const u = z
              .object({
                Id: z.number(),
                PropertyId: z.number(),
                IsUnitOccupied: z.boolean(),
                IsUnitListed: z.boolean(),
                MarketRent: z.number().nonnegative().nullable().optional(),
              })
              .parse(r);
            add({
              key: `unit-${id}-available`,
              date: today,
              metric: "available_units",
              value: Number(!u.IsUnitOccupied && u.IsUnitListed),
              reference: `Buildium unit ${id}`,
            });
            if (u.MarketRent != null)
              add({
                key: `unit-${id}-rent`,
                date: today,
                metric: "market_rent",
                value: u.MarketRent,
                reference: `Buildium unit ${id}`,
              });
          } else {
            const lease = z
              .object({
                Id: z.number(),
                PropertyId: z.number(),
                LeaseStatus: z.string(),
              })
              .parse(r);
            add({
              key: `lease-${id}`,
              date: today,
              metric: "active_leases",
              value: Number(lease.LeaseStatus === "Active"),
              reference: `Buildium lease ${id}`,
            });
          }
        }
        if (data.length < 1000) break;
        if (offset === 5000)
          throw new Error("This source exceeds the import limit.");
      }
    }
  }
  return batchSchema.parse({
    provider: config.provider,
    account,
    source: providerNames[config.provider],
    start,
    end,
    observedAt: now,
    limitations,
    rows,
  });
}
