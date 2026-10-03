"use client";
import { ClientProgress } from "./ClientProgress";
import { FunnelSummary } from "./FunnelSummary";
import { ClientPortalHeader } from "./ClientPortalHeader";
import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  MapPin,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import { getMarketingChannelLabel } from "@/utils/analytics/channel-identity";
import type { PortalData, ClientReport } from "@/utils/client-portal/contracts";
const count = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const money = (n: number | null) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);
const date = (s: string) =>
  new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const titles: Record<string, { title: string; description: string }> = {
  overview: {
    title: "A clearer view of your properties.",
    description: "Your latest results, together in one place.",
  },
  performance: {
    title: "Performance, in perspective.",
    description:
      "Understand how your marketing is reaching people and generating interest.",
  },
  properties: {
    title: "Your property portfolio.",
    description: "The properties your P11 team is looking after.",
  },
  reports: {
    title: "Your reporting library.",
    description: "Reviewed monthly reports from your P11 team.",
  },
};
function download(report: ClientReport) {
  const rows = [
    ["Report", report.name],
    ["Property", report.propertyName],
    ["Period", report.start + " to " + report.end],
    ["Ad spend (USD)", report.totals.spend ?? "Not available"],
    ["Impressions", report.totals.impressions],
    ["Clicks", report.totals.clicks],
    ["Reported conversions", report.totals.conversions],
    ["Source records", report.records],
    ["Client summary", report.summary],
    ["Next steps", report.nextSteps],
    [
      "Reported cohort applications",
      report.evidence?.funnel.applications ?? "Unavailable",
    ],
    ["Reported cohort leases", report.evidence?.funnel.leases ?? "Unavailable"],
    [
      "Note",
      "Reported conversions are platform-attributed actions, not verified leases.",
    ],
  ];
  const csv = rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            String(v)
              .replace(/^(?=[=+@-])/, "'")
              .replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "P11-report-" + report.start + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Trend({ data }: { data: PortalData }) {
  const points = data.trend,
    maximum = Math.max(...points.map((p) => p.clicks), 1),
    width = 720,
    height = 180;
  const x = (day: string) =>
    ((Date.parse(day) - Date.parse(data.period.start)) /
      Math.max(
        86400000,
        Date.parse(data.period.end) - Date.parse(data.period.start),
      )) *
    width;
  const line = points
    .map((p) => `${x(p.date)},${height - (p.clicks / maximum) * (height - 15)}`)
    .join(" ");
  return (
    <section className="console-panel">
      <div className="console-panel-heading">
        <div>
          <h2>Interest over time</h2>
          <p>Clicks from your connected marketing channels</p>
        </div>
        <span className="console-tag">
          <span className="h-1.5 w-1.5 rounded-full bg-[#df461b]" />
          Clicks
        </span>
      </div>
      {points.length ? (
        <div className="p-6">
          <div className="flex gap-4">
            <div className="flex w-8 flex-col justify-between pb-1 text-[10px] text-slate-400">
              <span>{count(maximum)}</span>
              <span>{count(maximum / 2)}</span>
              <span>0</span>
            </div>
            <svg
              viewBox={`0 0 ${width} ${height + 5}`}
              className="w-full overflow-visible"
              role="img"
              aria-label={`Marketing clicks across ${points.length} days with recorded data`}
            >
              <defs>
                <linearGradient
                  id="portal-trend-fill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#fa4616" stopOpacity=".28" />
                  <stop offset="100%" stopColor="#fa4616" stopOpacity=".01" />
                </linearGradient>
              </defs>
              {[0, 0.5, 1].map((n) => (
                <line
                  key={n}
                  x1="0"
                  y1={height * n}
                  x2={width}
                  y2={height * n}
                  stroke="#e9eef1"
                  strokeDasharray="3 5"
                />
              ))}
              {points.length > 1 && (
                <polygon
                  points={`${x(points[0].date)},${height} ${line} ${x(points.at(-1)!.date)},${height}`}
                  fill="url(#portal-trend-fill)"
                />
              )}
              <polyline
                points={line}
                fill="none"
                stroke="#df461b"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.length === 1 && (
                <circle
                  cx={x(points[0].date)}
                  cy={height - (points[0].clicks / maximum) * (height - 15)}
                  r="4"
                  fill="#df461b"
                />
              )}
            </svg>
          </div>
          <div className="ml-12 mt-4 flex justify-between text-[10px] text-slate-400">
            <span>{date(data.period.start)}</span>
            <span>{date(data.period.end)}</span>
          </div>
          <details className="mt-5 text-xs text-slate-500">
            <summary className="cursor-pointer">View daily figures</summary>
            <div className="mt-3 max-h-56 overflow-auto">
              <table className="console-table">
                <caption className="sr-only">
                  Daily marketing clicks. Dates without records are omitted.
                </caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Clicks</th>
                    <th>Impressions</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.date}>
                      <td>{date(p.date)}</td>
                      <td>{count(p.clicks)}</td>
                      <td>{count(p.impressions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ) : (
        <div className="console-empty">
          <BarChart3 size={29} strokeWidth={1.2} />
          <strong>Your performance story starts here</strong>
          <p>
            Results will appear once your team connects marketing data for this
            period.
          </p>
        </div>
      )}
    </section>
  );
}
export function ClientPortal({ view }: { view: string }) {
  const params = useSearchParams(),
    path = usePathname(),
    router = useRouter(),
    property = params.get("propertyId") ?? "",
    days = params.get("days") ?? "30",
    offset = params.get("reportOffset") ?? "0";
  const [navigating, startNavigation] = useTransition();
  const [revision, setRevision] = useState(0);
  const requestKey = JSON.stringify([property, days, offset, revision]);
  const [response, setResponse] = useState<{
      key: string;
      data: PortalData | null;
      error: string;
    } | null>(null),
    [selection, setSelection] = useState<{
      key: string;
      report: ClientReport;
    } | null>(null);
  const loading = response?.key !== requestKey,
    data = loading ? null : response.data,
    error = !loading ? response.error : "",
    selectedReport = selection?.key === requestKey ? selection.report : null;
  const setSelectedReport = (report: ClientReport | null) =>
    setSelection(report ? { key: requestKey, report } : null);
  useEffect(() => {
    const controller = new AbortController();
    const q = new URLSearchParams({ days, reportOffset: offset });
    if (property) q.set("propertyId", property);
    void fetch("/api/client-portal/overview?" + q, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(body.error ?? "Your results are unavailable.");
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data: body, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setResponse({
            key: requestKey,
            data: null,
            error:
              e instanceof Error ? e.message : "Your results are unavailable.",
          });
        }
      });
    return () => controller.abort();
  }, [property, days, offset, requestKey]);
  const target = useCallback(
    (href: string, change: Record<string, string> = {}) => {
      const q = new URLSearchParams(params);
      q.delete("reportOffset");
      for (const [k, v] of Object.entries(change)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      return href + (q.size ? "?" + q.toString() : "");
    },
    [params],
  );
  const title = titles[view],
    current = data?.properties.find((p) => p.id === property);
  return (
    <div className="console-shell portal-shell min-h-dvh">
      <a
        href="#client-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <ClientPortalHeader
        view={view}
        name={data?.name}
        hasConversations={!!data?.hasLumaLeasing}
        href={target}
      />
      <main id="client-content" className="portal-main">
        <div className="portal-page-heading">
          <div>
            <p className="console-kicker">
              {current?.name ?? "Your portfolio"}
            </p>
            <h1>{title.title}</h1>
            <p>{title.description}</p>
          </div>
          <div className="portal-filters">
            <label>
              <span className="sr-only">Property</span>
              <Building2 size={15} aria-hidden="true" />
              <select
                aria-label="Property"
                value={property}
                onChange={(e) =>
                  startNavigation(() =>
                    router.push(target(path, { propertyId: e.target.value })),
                  )
                }
                disabled={navigating || (loading && !data)}
              >
                <option value="">All properties</option>
                {data?.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            {view !== "properties" && (
              <label>
                <CalendarDays size={15} aria-hidden="true" />
                <select
                  aria-label="Reporting period"
                  disabled={navigating}
                  value={days}
                  onChange={(e) =>
                    startNavigation(() =>
                      router.push(target(path, { days: e.target.value })),
                    )
                  }
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
            )}
            <button
              onClick={() => setRevision((v) => v + 1)}
              aria-label="Refresh results"
              className="console-action"
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="console-error mb-6">
            <p>{error}</p>
            <p className="mt-1">
              If your access has changed, your P11 team can help.
            </p>
            <button
              className="mt-3 underline"
              onClick={() => setRevision((v) => v + 1)}
            >
              Try again
            </button>
          </div>
        )}
        {loading ? (
          <div
            role="status"
            aria-label="Loading your results"
            className="grid grid-cols-2 gap-5 lg:grid-cols-4"
          >
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="console-metric h-36 animate-pulse">
                <div className="h-3 w-24 rounded bg-slate-100" />
                <div className="mt-5 h-8 w-20 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : (
          data && (
            <>
              {!data.properties.length ? (
                <section className="console-panel console-empty">
                  <Building2 size={32} />
                  <strong>Your workspace is ready</strong>
                  <p>
                    Your team will assign your properties here. There’s nothing
                    you need to set up.
                  </p>
                </section>
              ) : (
                <>
                  {["overview", "performance"].includes(view) && (
                    <ClientProgress data={data} />
                  )}
                  {["overview", "performance"].includes(view) && (
                    <div className="console-overview-metrics grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">
                      {[
                        {
                          label: "New inquiries",
                          value: count(data.inquiries),
                          icon: Users,
                          note: "Inquiry records received in this period",
                        },
                        {
                          label: "Tours",
                          value: count(data.tours),
                          icon: CalendarDays,
                          note: "Inquiry records with a tour in this period",
                        },
                        {
                          label: "Marketing spend",
                          value: data.hasMarketingData
                            ? money(data.marketing.spend)
                            : "—",
                          icon: BarChart3,
                          note: data.hasMarketingData
                            ? "Recorded spend · USD where confirmed"
                            : "Awaiting marketing data",
                        },
                        {
                          label: "Marketing clicks",
                          value: data.hasMarketingData
                            ? count(data.marketing.clicks)
                            : "—",
                          icon: ArrowUpRight,
                          note: data.hasMarketingData
                            ? "Clicks from connected channels"
                            : "Awaiting marketing data",
                        },
                      ].map((m) => (
                        <section key={m.label} className="console-metric">
                          <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-xs font-medium text-slate-500">
                              {m.label}
                            </h2>
                            <m.icon
                              size={17}
                              className="text-slate-400"
                              strokeWidth={1.5}
                            />
                          </div>
                          <p className="console-metric-value">{m.value}</p>
                          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                            {m.note}
                          </p>
                        </section>
                      ))}
                    </div>
                  )}
                  {["overview", "performance"].includes(view) && (
                    <div className="mt-6 grid gap-6 xl:grid-cols-[1.8fr_1fr]">
                      <Trend data={data} />
                      <section className="console-panel">
                        <div className="console-panel-heading">
                          <div>
                            <h2>Channel overview</h2>
                            <p>Where your audience is finding you</p>
                          </div>
                        </div>
                        {data.channels.length ? (
                          <div className="space-y-5 p-6">
                            {data.channels.map((channel, i) => (
                              <div key={channel.channel}>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <span className="text-xs text-slate-600">
                                    {getMarketingChannelLabel(channel.channel)}
                                  </span>
                                  <span className="text-xs font-medium">
                                    {count(channel.clicks)} clicks
                                  </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    style={{
                                      width:
                                        Math.max(
                                          0,
                                          (channel.clicks /
                                            Math.max(
                                              data.marketing.clicks,
                                              1,
                                            )) *
                                            100,
                                        ) + "%",
                                      background: [
                                        "#df461b",
                                        "#929292",
                                        "#b7aaa2",
                                        "#2d62ff",
                                      ][i % 4],
                                    }}
                                    className="h-full rounded-full"
                                  />
                                </div>
                              </div>
                            ))}
                            <p className="pt-3 text-[10px] leading-relaxed text-slate-400">
                              Includes available records for{" "}
                              {date(data.period.start)}–{date(data.period.end)}.
                              Missing data is not filled in.
                            </p>
                          </div>
                        ) : (
                          <div className="console-empty">
                            <Building2 size={25} strokeWidth={1.2} />
                            <strong>No channel results yet</strong>
                            <p>
                              Your team will connect the relevant marketing
                              sources.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                  {["overview", "properties"].includes(view) && (
                    <section className="mt-6 console-panel">
                      <div className="console-panel-heading">
                        <div>
                          <h2>
                            {view === "overview"
                              ? "Your properties"
                              : "Property information"}
                          </h2>
                          <p>
                            {data.properties.length}{" "}
                            {data.properties.length === 1
                              ? "property"
                              : "properties"}{" "}
                            in your workspace
                          </p>
                        </div>
                        {view === "overview" && (
                          <Link
                            href={target("/client/properties")}
                            className="text-xs text-[#a53212] flex items-center gap-2"
                          >
                            View properties
                            <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                      <div className="grid gap-0 divide-y divide-slate-100">
                        {data.properties
                          .filter((p) => !property || p.id === property)
                          .map((p, i) => (
                            <Link
                              key={p.id}
                              href={target("/client/performance", {
                                propertyId: p.id,
                              })}
                              className="portal-property-row"
                            >
                              <div
                                className={`portal-property-icon ${i % 2 ? "is-sage" : ""}`}
                              >
                                <Building2 size={25} strokeWidth={1.25} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-medium truncate">
                                  {p.name}
                                </h3>
                                <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
                                  <MapPin size={12} />
                                  {[p.address.city, p.address.state]
                                    .filter(Boolean)
                                    .join(", ") ||
                                    "Property address not yet available"}
                                </p>
                                {view === "properties" && p.address.street && (
                                  <p className="mt-1 text-xs text-slate-500">
                                    {p.address.street}
                                    {p.address.zip ? ", " + p.address.zip : ""}
                                  </p>
                                )}
                              </div>
                              <div className="hidden shrink-0 sm:block">
                                <span className="console-tag">
                                  <Check size={11} />
                                  In your portfolio
                                </span>
                              </div>
                              <ArrowUpRight
                                size={16}
                                className="shrink-0 text-slate-400"
                              />
                            </Link>
                          ))}
                      </div>
                    </section>
                  )}
                  {["overview", "reports"].includes(view) && (
                    <section className="mt-6 console-panel">
                      <div className="console-panel-heading">
                        <div>
                          <h2>
                            {view === "overview"
                              ? "Latest reports"
                              : "Saved reports"}
                          </h2>
                          <p>
                            Snapshots of your recorded marketing performance
                          </p>
                        </div>
                        {view === "overview" && (
                          <Link
                            href={target("/client/reports")}
                            className="text-xs text-[#a53212] flex items-center gap-2"
                          >
                            All reports
                            <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                      {data.reports.length ? (
                        <>
                          <div className="overflow-x-auto">
                            <table className="console-table">
                              <thead>
                                <tr>
                                  <th>Report</th>
                                  <th className="hidden sm:table-cell">
                                    Period
                                  </th>
                                  <th>
                                    <span className="sr-only">Open report</span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.reports
                                  .slice(0, view === "overview" ? 3 : 20)
                                  .map((report) => (
                                    <tr key={report.id}>
                                      <td>
                                        <div className="flex items-center gap-3">
                                          <FileText
                                            size={19}
                                            strokeWidth={1.5}
                                            className="shrink-0 text-slate-400"
                                          />
                                          <div>
                                            <p className="font-medium">
                                              {report.name}
                                            </p>
                                            <p className="mt-1 text-[11px] text-slate-400">
                                              {report.propertyName}
                                            </p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="hidden sm:table-cell text-xs!">
                                        {date(report.start)} –{" "}
                                        {date(report.end)}
                                      </td>
                                      <td className="text-right">
                                        <button
                                          onClick={() =>
                                            setSelectedReport(report)
                                          }
                                          className="console-action"
                                        >
                                          View report
                                          <ArrowUpRight size={13} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                          {view === "reports" &&
                            (Number(offset) > 0 ||
                              data.nextReportOffset !== null) && (
                              <div className="flex gap-3 justify-end p-4">
                                <button
                                  className="console-action"
                                  disabled={Number(offset) === 0}
                                  onClick={() =>
                                    router.push(
                                      target(path, {
                                        reportOffset: String(
                                          Math.max(0, Number(offset) - 20),
                                        ),
                                      }),
                                    )
                                  }
                                >
                                  Previous reports
                                </button>
                                <button
                                  className="console-action"
                                  disabled={data.nextReportOffset === null}
                                  onClick={() =>
                                    router.push(
                                      target(path, {
                                        reportOffset: String(
                                          data.nextReportOffset,
                                        ),
                                      }),
                                    )
                                  }
                                >
                                  More reports
                                </button>
                              </div>
                            )}
                        </>
                      ) : (
                        <div className="console-empty">
                          <FileText size={27} strokeWidth={1.2} />
                          <strong>Your reports will live here</strong>
                          <p>
                            Once your team saves a marketing report, you can
                            review and download its summary here.
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
              <footer className="portal-footer">
                <span>P11 · Real estate marketing. Amplified.</span>
                <span>
                  View refreshed{" "}
                  {new Date(data.updatedAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </footer>
            </>
          )
        )}
      </main>
      {selectedReport && (
        <ReportDialog
          report={selectedReport}
          close={() => setSelectedReport(null)}
        />
      )}
    </div>
  );
}
function ReportDialog({
  report,
  close,
}: {
  report: ClientReport;
  close: () => void;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = document.getElementById("client-report-close");
    node?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-report-title"
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Tab") {
            const list = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button, a[href], input, select, textarea, summary",
              ),
            ).filter((node) => node.getClientRects().length > 0);
            if (e.shiftKey && document.activeElement === list[0]) {
              e.preventDefault();
              list.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
              e.preventDefault();
              list[0]?.focus();
            }
          }
        }}
      >
        <div className="console-panel-heading">
          <div>
            <p className="console-kicker">{report.propertyName}</p>
            <h2 id="client-report-title">{report.name}</h2>
          </div>
          <button
            id="client-report-close"
            className="console-action border-0!"
            aria-label="Close report"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">
          <p className="text-xs text-slate-500">
            {date(report.start)} – {date(report.end)}
          </p>
          <div className="my-6 grid grid-cols-2 gap-5">
            {[
              [
                "Marketing spend",
                report.records ? money(report.totals.spend) : "—",
              ],
              [
                "Impressions",
                report.records ? count(report.totals.impressions) : "—",
              ],
              ["Clicks", report.records ? count(report.totals.clicks) : "—"],
              [
                "Reported conversions",
                report.records ? count(report.totals.conversions) : "—",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-medium tracking-tight">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            These figures are from this saved report. Reported conversions are
            actions attributed by marketing platforms, and do not represent
            verified leases.{" "}
            {report.records === 0
              ? "No marketing source records were available for this report."
              : ""}
          </p>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-medium">What this means for your property</h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {report.summary}
            </p>
            <h3 className="mt-5 font-medium">Next steps</h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {report.nextSteps}
            </p>
            {report.evidence && (
              <div className="mt-5">
                <FunnelSummary
                  current={report.evidence.funnel}
                  previous={report.evidence.previousFunnel}
                />
                {report.evidence.completedWork.length > 0 && (
                  <>
                    <h3 className="font-medium">Work completed</h3>
                    {report.evidence.completedWork.map((w) => (
                      <p key={w.id} className="mt-2 text-sm leading-6">
                        {w.title}: {w.summary}
                      </p>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <button
            className="console-action mt-6"
            onClick={() => download(report)}
          >
            <ArrowDownToLine size={15} />
            Download summary
          </button>
        </div>
      </section>
    </div>
  );
}
