"use client";
import { useState, useEffect, useCallback } from "react";
import { fieldRegistry } from "@/utils/intelligence/contracts";
import type { Portfolio } from "@/utils/intelligence/portfolio";
const day = (date: Date) => date.toISOString().slice(0, 10);
const number = (v: number | null) =>
  v === null
    ? "Unavailable"
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
export function InsightsView({
  client = false,
  propertyId,
}: {
  client?: boolean;
  propertyId?: string;
}) {
  const [end, setEnd] = useState(() => day(new Date())),
    [start, setStart] = useState(() =>
      day(new Date(Date.now() - 29 * 86400000)),
    ),
    [data, setData] = useState<Portfolio | null>(null),
    [error, setError] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const endpoint = client ? "/api/client/intelligence" : "/api/intelligence";
  const load = useCallback(
    async (signal?: AbortSignal) => {
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
    [start, end, endpoint, propertyId],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [load]);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        start,
        end,
        question,
        ...(propertyId ? { propertyId } : {}),
      });
      const r = client
        ? await fetch(`${endpoint}?${params}`)
        : await fetch(endpoint, {
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
      setAnswer(body.answer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 text-gray-900">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          From
          <input
            aria-label="Insights start date"
            type="date"
            value={start}
            onChange={(e) => {
              setData(null);
              setStart(e.target.value);
              setAnswer([]);
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
              setAnswer([]);
              setError("");
            }}
            className="mt-1 block rounded-lg border bg-white p-2"
          />
        </label>
        <button
          className="console-action"
          onClick={() => {
            setError("");
            void load()
              .then(setData)
              .catch((e) => setError(e.message));
          }}
        >
          Refresh insights
        </button>
      </div>
      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading your property evidence…</p>}
      {data && (
        <>
          <section className="console-panel p-6">
            <h2 className="text-xl font-semibold">What needs attention</h2>
            <p className="mt-2 text-sm text-gray-600">
              Observed changes for {data.start} to {data.end}. Explanations
              distinguish evidence from possible causes.
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
                  No rules identified a material exception in the available
                  records. Review source coverage below.
                </li>
              )}
            </ul>
          </section>
          <section className="console-panel overflow-x-auto p-6">
            <h2 className="text-xl font-semibold">Property comparison</h2>
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
          <section className="console-panel p-6">
            <h2 className="text-xl font-semibold">Ask about these results</h2>
            <p className="mt-2 text-sm text-gray-600">
              Compare properties, review changes, find missing sources, or check
              experiment results. Answers use only the properties you can
              access.
            </p>
            <form onSubmit={ask} className="mt-4 flex flex-wrap gap-3">
              <input
                aria-label="Question about property results"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
                placeholder="Which properties have the most recorded tours?"
                className="min-w-64 flex-1 rounded-lg border p-3"
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
                  Evidence: this authorized portfolio, {start}–{end}. Refresh to
                  include later corrections.
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
              <h3 className="mt-5 font-medium">Source coverage</h3>
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
              <h3 className="mt-6 font-medium">
                Experience and product observations
              </h3>
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
              <h3 className="mt-6 font-medium">
                Market context and comparison
              </h3>
              <p className="mt-2 text-sm">
                {p.score.market ?? "Market has not been reviewed."}
              </p>
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
              <div className="mt-3 space-y-2 text-sm">
                {p.market.units.slice(0, 10).map((u) => (
                  <p key={u.id}>
                    {
                      p.market.competitors.find((c) => c.id === u.competitor_id)
                        ?.name
                    }{" "}
                    · {u.unit_type}:{" "}
                    {u.rent_min === null
                      ? "Rent unavailable"
                      : `$${number(u.rent_min)}`}
                    {u.rent_max && u.rent_max !== u.rent_min
                      ? `–$${number(u.rent_max)}`
                      : ""}{" "}
                    · Observed{" "}
                    {u.last_updated_at?.slice(0, 10) ?? "date unavailable"}
                  </p>
                ))}
                <p className="text-xs text-gray-500">
                  {p.market.note}
                  {p.market.limited ? " Showing a limited recent sample." : ""}
                </p>
              </div>
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
          <p className="text-xs leading-5 text-gray-500">
            {data.limitations.join(" ")}
          </p>
        </>
      )}
    </div>
  );
}
