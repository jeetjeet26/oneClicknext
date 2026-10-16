"use client";
import { ReportingDetail } from "./ReportingDetail";
import { MarketObservations } from "./MarketObservations";
import { WorkspaceDisclosure, WorkspaceNotice } from "@/components/ui/WorkspaceSection";
import { useState, useEffect, useCallback, useRef } from "react";
import { fieldRegistry } from "@/utils/intelligence/contracts";
import type { Portfolio } from "@/utils/intelligence/portfolio";
const displayDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (date: Date) => date.toISOString().slice(0, 10);
const number = (v: number | null) =>
  v === null
    ? "Unavailable"
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
export function InsightsView({
  client = false,
  propertyId,
  propertyName,
  periodDays = 30,
}: {
  client?: boolean;
  propertyId?: string;
  propertyName?: string;
  periodDays?: number;
}) {
  const [end, setEnd] = useState(() => day(new Date())),
    [start, setStart] = useState(() =>
      day(new Date(Date.now() - (periodDays - 1) * 86400000)),
    ),
    [data, setData] = useState<Portfolio | null>(null),
    [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null),
    [question, setQuestion] = useState(""),
    [answerState, setAnswerState] = useState<{ scope: string; lines: string[] } | null>(null),
    [busyScope, setBusyScope] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadedScope, setLoadedScope] = useState("");
  const questionRequest = useRef<AbortController | null>(null);
  const scope = `${propertyId ?? "portfolio"}:${start}:${end}:${client}`;
  const error = errorState?.scope === scope ? errorState.message : "";
  const answer = answerState?.scope === scope ? answerState.lines : [];
  const busy = busyScope === scope;
  const setError = (message: string) => setErrorState({ scope, message });
  const endpoint = client ? "/api/client/intelligence" : "/api/intelligence";
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!client && !propertyId) throw new Error("Select a property to view its results.");
      const params = new URLSearchParams({
        kind: "portfolio",
        start,
        end,
        ...(propertyId ? { propertyId } : {}),
      });
      const r = await fetch(`${endpoint}?${params}`, { signal });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      return body;
    },
    [start, end, endpoint, propertyId, client],
  );
  useEffect(() => {
    const c = new AbortController();
    questionRequest.current?.abort();
    void load(c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setData(v);
          setLoadedScope(scope);
          setErrorState(null);
          setBusyScope(null);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) { setErrorState({ scope, message: e.message }); setBusyScope(null); }
      });
    return () => { c.abort(); questionRequest.current?.abort(); };
  }, [load, refresh, scope]);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    questionRequest.current?.abort();
    const controller = new AbortController();
    questionRequest.current = controller;
    setBusyScope(scope);
    setError("");
    try {
      if (!client && !propertyId) throw new Error("Select a property to ask about its results.");
      const params = new URLSearchParams({
        start,
        end,
        question,
        ...(propertyId ? { propertyId } : {}),
      });
      const r = client
        ? await fetch(`${endpoint}?${params}`, { signal: controller.signal })
        : await fetch(endpoint, {
            signal: controller.signal,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "question",
              question,
              start,
              end,
              propertyId,
            }),
          });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (!controller.signal.aborted) setAnswerState({ scope, lines: body.answer });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusyScope(null);
    }
  }
  return (
    <div className="space-y-6 text-gray-900">
      <div className="flex flex-wrap items-end gap-4">
        {!client && <><label className="text-sm">
          From
          <input
            aria-label="Insights start date"
            type="date"
            value={start}
            onChange={(e) => {
              setData(null);
              setStart(e.target.value);
              setAnswerState(null);
              setError("");
            }}
            className="mt-1 block rounded-lg border bg-white p-2"
          />
        </label>
        <label className="text-sm">
          To
          <input
            aria-label="Insights end date"
            type="date"
            value={end}
            onChange={(e) => {
              setData(null);
              setEnd(e.target.value);
              setAnswerState(null);
              setError("");
            }}
            className="mt-1 block rounded-lg border bg-white p-2"
          />
        </label>
        </>}
        <button
          className="console-action"
          onClick={() => { setBusyScope(null); setAnswerState(null); setRefresh(value => value + 1); }}
        >
          Refresh results
        </button>
      </div>
      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}
      {(!data || loadedScope !== scope) && !error && <p role="status">Loading results…</p>}
      {data && loadedScope === scope && (
        <>
          {data.properties.length === 1 ? <section className="console-panel p-6" aria-label="Performance summary">
            <h2 className="text-xl font-semibold">{data.properties[0].score.name} at a glance</h2>
            <dl className="workspace-stat-grid mt-5">{[
              ["Marketing spend", data.properties[0].score.observedDays ? `$${number(data.properties[0].score.spend)}` : "Unavailable", `${data.properties[0].score.observedDays} of ${data.properties[0].score.days} days recorded`],
              ["Recorded inquiries", number(data.properties[0].score.inquiries), "Inquiries first recorded in this period"],
              ["Recorded tours", number(data.properties[0].score.tours), "Outcomes for those inquiries"],
              ["Reported leases", number(data.properties[0].score.leases), "Outcomes for those inquiries"],
            ].map(([label, value, note]) => <div className="workspace-stat" key={label}><dt>{label}</dt><dd>{value}</dd><p>{note}</p></div>)}</dl>
            <p className="mt-4 text-sm text-gray-600">Marketing clicks: {data.properties[0].score.observedDays ? number(data.properties[0].score.clicks) : "Unavailable"}. These counts do not establish a connection between advertising and signed leases.</p>
          </section> : <>          <section className="console-panel overflow-x-auto p-6">
            <h2 className="text-xl font-semibold">{propertyId ? `${propertyName ?? "Property"} performance` : "Property comparison"}</h2>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Property",
                    "Marketing days",
                    "Spend (USD)",
                    "Clicks",
                    "Inquiries",
                    "Tours",
                    "Reported leases",
                  ].map((s) => (
                    <th key={s} className="border-b p-3 font-medium">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.properties.map(({ score: s }) => (
                  <tr key={s.id}>
                    {[
                      s.name,
                      `${s.observedDays}/${s.days}`,
                      s.observedDays ? number(s.spend) : "Unavailable",
                      s.observedDays ? number(s.clicks) : "Unavailable",
                      number(s.inquiries),
                      number(s.tours),
                      number(s.leases),
                    ].map((v, i) => (
                      <td className="border-b p-3" key={i}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500">
              Inquiries and outcomes are recorded cohorts, not a joined
              advertising-to-lease funnel.
            </p>
          </section>
</>}
          <section className="console-panel p-6">
            <h2 className="text-xl font-semibold">What needs attention</h2>
            <p className="mt-2 text-sm text-gray-600">
              {displayDate(data.start)} to {displayDate(data.end)} · Based on the records available for this period.
            </p>
            <ul className="mt-4 space-y-3">
              {data.briefing.length ? (
                data.briefing.map((s, i) => (
                  <li
                    key={i}
                    className="border-l-2 border-[#df461b] pl-4 text-sm leading-6"
                  >
                    {s}
                  </li>
                ))
              ) : (
                <li className="text-sm">
                  No significant change was flagged in the available records. Check data coverage before drawing conclusions.
                </li>
              )}
            </ul>
          </section>
          <section className="console-panel p-6">
            <h2 className="text-xl font-semibold">Ask about these results</h2>
            <p className="mt-2 text-sm text-gray-600">
              {propertyId ? (client ? "Review this community’s changes and next steps. Select All properties to compare your communities." : "Review this property’s changes, missing sources and experiment results. Use the portfolio assistant to compare communities.") : "Compare properties, review changes, find missing sources, or check experiment results. Answers use only your assigned properties."}
            </p>
            <form onSubmit={ask} className="mt-4 flex flex-wrap gap-3">
              <input
                aria-label="Question about property results"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
                placeholder={propertyId ? "What changed in recorded tours?" : "Which properties have the most recorded tours?"}
                className="min-w-0 basis-64 flex-1 rounded-lg border p-3"
              />
              <button
                className="console-action-primary"
                disabled={busy || !question.trim()}
              >
                {busy ? "Reading evidence…" : "Ask"}
              </button>
            </form>
            {answer.length > 0 && (
              <div role="status" className="mt-4 space-y-2 border-t pt-4">
                {answer.map((a, i) => (
                  <p key={i} className="text-sm leading-6">
                    {a}
                  </p>
                ))}
                <p className="text-xs text-gray-500">
                  Based on available records for {start}–{end}. Refresh to include later corrections.
                </p>
              </div>
            )}
          </section>
          {data.properties.map((p) => (
            <section key={p.score.id} className="console-panel p-6">
              <h2 className="text-xl font-semibold">{p.score.name}</h2>
              {p.facts.length > 0 && (
                <details className="mt-5">
                  <summary className="cursor-pointer font-medium">
                    Reviewed property information
                  </summary>
                  <dl className="mt-3 space-y-4">
                    {p.facts.map((f) => (
                      <div key={f.id}>
                        <dt className="text-sm font-medium">
                          {fieldRegistry[f.field][0]}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm">
                          {f.value}
                        </dd>
                        <dd className="mt-1 text-xs text-gray-500">
                          {f.source} · As of {f.observedAt} · Review by{" "}
                          {f.reviewAfter}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              {p.incompleteMarketingRows > 0 && <p role="status" className="mt-3 text-sm">Results exclude {p.incompleteMarketingRows} incomplete marketing records. Totals may understate activity; missing measures are not zero.</p>}
              <div className="my-5"><WorkspaceDisclosure title="How these results are calculated" description="Source totals, stage comparisons, spending and attribution"><ReportingDetail measures={p.periodMeasures} rates={p.stageRatios} attribution={p.attribution} spending={p.spending} /></WorkspaceDisclosure></div>
              {p.score.observedDays < p.score.days && <WorkspaceNotice title="Marketing data is incomplete"><p>{p.score.observedDays} of {p.score.days} days have recorded marketing data. Totals may understate activity.</p></WorkspaceNotice>}
              <div className="my-5"><WorkspaceDisclosure title="Check data coverage" description="Connected sources and the latest records">
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {p.coverage.map((c) => (
                  <div
                    key={c.provider}
                    className="rounded-lg bg-stone-50 p-4 text-sm"
                  >
                    <strong>{c.provider.replaceAll("_", " ")}</strong>
                    <p className="mt-1">{c.status}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {c.latest
                        ? `Latest observation ${c.latest}${c.syncedAt ? ` · Retrieved ${c.syncedAt.slice(0, 10)}` : ""}`
                        : "Connection and reviewed data are required."}
                    </p>
                  </div>
                ))}
              </div>
              </WorkspaceDisclosure></div>
              <div className="my-5"><WorkspaceDisclosure title="Website and floor plan details" description="Device, search and floor plan measurements">
              {p.diagnostics.length ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        {[
                          "Measure",
                          "Device / product",
                          "Value",
                          "Source",
                          "Latest",
                        ].map((s) => (
                          <th key={s} className="border-b p-2">
                            {s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.diagnostics.map((d) => (
                        <tr key={d.key}>
                          <td className="p-2">
                            {d.metric.replaceAll("_", " ")}
                          </td>
                          <td className="p-2">
                            {d.device}
                            {d.floorplanId ? ` / ${d.floorplanId}` : ""}
                            {d.page ? (
                              <p className="max-w-60 truncate text-xs">
                                {d.page}
                              </p>
                            ) : null}
                          </td>
                          <td className="p-2">
                            {number(d.value)}
                            {d.snapshot ? " (snapshot)" : ""}
                          </td>
                          <td className="p-2">
                            {d.sources.join(", ")}
                            <span className="block text-xs text-gray-500">
                              {!client && d.account ? `${d.account} · ` : ""}
                              {d.channel}
                            </span>
                          </td>
                          <td className="p-2">{d.latest}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  Device, floorplan and search diagnostics appear after reviewed
                  observations are available.
                </p>
              )}
              </WorkspaceDisclosure></div>
              <MarketObservations property={p} client={client} />
              <div className="mt-4"><WorkspaceDisclosure title="Compare with similar communities">
              {data.benchmarks
                .filter((b) => b.propertyId === p.score.id)
                .map((b) => (
                  <p key={b.propertyId} className="mt-2 text-sm">
                    Peer median spend per recorded inquiry:{" "}
                    {b.value === null
                      ? "Not enough comparable properties"
                      : `$${number(b.value)}`}{" "}
                    ({b.peerCount} eligible peers).{" "}
                    <span className="text-gray-500">{b.note}</span>
                  </p>
                ))}
              </WorkspaceDisclosure></div>
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Recorded changes in this period
                </summary>
                <ul className="mt-2 space-y-2 text-xs text-gray-600">
                  {p.changes.events.map((e) => (
                    <li key={e.id}>
                      {e.created_at.slice(0, 10)} · {e.product} · {e.action}
                    </li>
                  ))}
                </ul>
                {!p.changes.events.length && (
                  <p className="mt-2 text-sm text-gray-500">
                    No recorded changes in this period.
                  </p>
                )}
              </details>
              {p.recommendations.length > 0 && (
                <>
                  <h3 className="mt-6 font-medium">Reviewed recommendations</h3>
                  <ul className="mt-3 space-y-4">
                    {p.recommendations.map((r) => (
                      <li key={r.id} className="rounded-lg border p-4">
                        <strong>{r.title}</strong>
                        <span className="ml-3 text-xs">{r.status}</span>
                        <p className="mt-2 text-sm">{r.rationale}</p>
                        <p className="mt-2 text-xs text-gray-500">
                          {!client && r.owner ? `Owner: ${r.owner} · ` : ""}
                          Measure: {r.targetMetric} · Evidence strength:{" "}
                          {r.confidence}
                        </p>
                        {r.result && (
                          <p className="mt-2 text-sm">
                            Staff-reported result: {r.result}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {p.experiments.map((e) => (
                <div key={e.id} className="mt-5 rounded-lg border p-4">
                  <h3 className="font-medium">{e.title}</h3>
                  <p className="mt-2 text-sm">{e.result}</p>
                  <p className="mt-2 text-sm">
                    Control: {number(e.control.conversions)} completions /{" "}
                    {number(e.control.sessions)} sessions. Treatment:{" "}
                    {number(e.treatment.conversions)} /{" "}
                    {number(e.treatment.sessions)}.
                  </p>
                  {e.ready && e.difference !== null && e.interval && (
                    <p className="mt-2 text-sm">
                      Difference: {number(e.difference * 100)} percentage
                      points. Approximate 95% uncertainty range:{" "}
                      {number(e.interval[0] * 100)} to{" "}
                      {number(e.interval[1] * 100)} percentage points.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">{e.limitations}</p>
                </div>
              ))}
            </section>
          ))}
          <WorkspaceDisclosure title="About these results"><p className="text-sm leading-relaxed text-gray-600">{data.limitations.join(" ")}</p></WorkspaceDisclosure>
        </>
      )}
    </div>
  );
}
