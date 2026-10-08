"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./intelligence.module.css";
import { usePropertyContext } from "@/components/layout/PropertyContext";
import {
  fieldRegistry,
  factSchema,
  creativeSchema,
  batchSchema,
  recommendationSchema,
  experimentSchema,
  type Document,
  type Kind,
  type Command,
  type Batch,
} from "@/utils/intelligence/contracts";
import {
  componentGuides,
  publishingTargets,
} from "@/utils/intelligence/components";
import { InsightsView } from "./InsightsView";
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const nextMonth = () =>
  new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const input =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm";
const blankFact = () => ({
  field: "lifecycle_stage",
  value: "",
  source: "",
  sourceUrl: "",
  observedAt: today(),
  effectiveFrom: null,
  effectiveTo: null,
  reviewAfter: nextMonth(),
  confidence: null,
  origin: "staff",
  visibility: "public",
});
type Workspace = {
  documents: Document[];
  events: Array<{
    id: string;
    product: string;
    action: string;
    purpose: "release" | "measurement";
    created_at: string;
  }>;
  history: Array<{
    id: string;
    input: {
      kind: string;
      operation: string;
      reason: string;
    };
    created_at: string;
  }>;
  connections: Array<{
    id: string;
    name: string;
    configured: boolean;
  }>;
  canManage: boolean;
};
export function IntelligenceWorkspace() {
  const { currentProperty } = usePropertyContext();
  return currentProperty ? (
    <PropertyWorkspace
      key={currentProperty.id}
      propertyId={currentProperty.id}
    />
  ) : (
    <p>Select a property to continue.</p>
  );
}
function PropertyWorkspace({ propertyId }: { propertyId: string }) {
  const [view, setView] = useState<Workspace | null>(null),
    [tab, setTab] = useState("facts"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Document | null>(null),
    [draft, setDraft] = useState<Record<string, unknown>>(blankFact),
    [preview, setPreview] = useState<Batch | null>(null);
  const [reason, setReason] = useState("Reviewed saved property information"),
    [start, setStart] = useState(today),
    [end, setEnd] = useState(today),
    [source, setSource] = useState(""),
    [account, setAccount] = useState("");
  const draftKey = useRef<string | null>(null);
  const pending = useRef<{
    key: string;
    id: string;
  } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await fetch(`/api/intelligence?propertyId=${propertyId}`, {
        signal,
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      return v;
    },
    [propertyId],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal)
      .then((v) => {
        if (!c.signal.aborted) setView(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [load]);
  const patch = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function command(
    kind: Kind,
    key: string,
    operation: Command["operation"],
    payload?: unknown,
    doc?: Document,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    const value = {
      propertyId,
      kind,
      key,
      expectedRevision: doc?.revision ?? 0,
      operation,
      payload,
      reason,
    };
    const identity = JSON.stringify(value);
    if (pending.current?.key !== identity)
      pending.current = { key: identity, id: crypto.randomUUID() };
    try {
      const r = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...value, requestId: pending.current.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      pending.current = null;
      await load().then(setView);
      setMessage(
        operation === "save"
          ? "Draft saved. Review it below before approving."
          : "Decision recorded.",
      );
      setEditing(kind === "fact" || kind === "batch" ? null : data.document);
      if (kind === "fact") setDraft(blankFact());
      else if (kind !== "batch") setDraft({ ...data.document.payload });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <label key={key} className="block text-sm font-medium">
      {label}
      {type === "textarea" ? (
        <textarea
          rows={3}
          className={input}
          value={String(draft[key] ?? "")}
          required={required}
          onChange={(e) => patch(key, e.target.value)}
        />
      ) : (
        <input
          type={type}
          className={input}
          value={String(draft[key] ?? "")}
          required={required}
          onChange={(e) =>
            patch(
              key,
              e.target.value ||
                (["releaseEvent", "measurementEvent"].includes(key)
                  ? null
                  : ""),
            )
          }
        />
      )}
    </label>
  );
  const eventField = (key: string, label: string, required = false) => (
    <label className="block text-sm font-medium">
      {label}
      <select
        className={input}
        value={String(draft[key] ?? "")}
        required={required}
        onChange={(e) => patch(key, e.target.value || null)}
      >
        <option value="">Choose a recorded product action</option>
        {view?.events
          .filter(
            (e) =>
              e.purpose ===
              (key === "measurementEvent" ? "measurement" : "release"),
          )
          .map((e) => (
            <option value={e.id} key={e.id}>
              {e.created_at.slice(0, 10)} · {e.product} ·{" "}
              {e.action.replaceAll(".", " ")}
            </option>
          ))}
      </select>
      <span className="mt-1 block text-xs text-gray-500">
        Only relevant recorded actions for this property are available. External
        delivery and outcomes remain staff-reported unless the source
        independently verifies them.
      </span>
    </label>
  );
  const downloadBatch = (batch: Batch) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(batch, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "p11-reviewed-observations.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const open = (doc: Document) => {
    setEditing(doc);
    setDraft({ ...(doc.payload as Record<string, unknown>) });
    setTab(
      doc.kind === "fact"
        ? "facts"
        : doc.kind === "creative"
          ? "creative"
          : doc.kind === "recommendation"
            ? "decisions"
            : doc.kind === "experiment"
              ? "experiments"
              : "sources",
    );
  };
  function changeTab(value: string) {
    setTab(value);
    setEditing(null);
    draftKey.current = null;
    setDraft(
      value === "facts"
        ? blankFact()
        : value === "creative"
          ? {
              title: "Property creative direction",
              references: [],
              componentKeys: componentGuides.map((c) => c.id),
              thesis: "",
              typography: "",
              palette: "",
              imagery: "",
              spacing: "",
              motion: "",
              hero: "",
              pageRhythm: "",
              voice: "",
              exceptions: "",
            }
          : value === "decisions"
            ? {
                title: "",
                rationale: "",
                targetMetric: "",
                owner: "",
                executionType: "website",
                confidence: "low",
                evidence: [],
                basecampUrl: "",
                expectedImpact: "",
                rollback: "",
                result: "",
                releaseEvent: null,
                measurementEvent: null,
              }
            : {
                title: "",
                hypothesis: "",
                metric: "tour_completions",
                denominator: "sessions",
                assignment: "randomized",
                assignmentReference: "",
                start: tomorrow(),
                end: nextMonth(),
                minimumPerArm: 100,
                minimumEffect: 0.02,
                guardrail: "",
                releaseEvent: "",
                confounders: "",
                notes: "",
              },
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (tab === "facts") {
        const value = factSchema.parse(draft);
        await command(
          "fact",
          value.field,
          "save",
          value,
          editing ??
            view?.documents.find(
              (d) => d.kind === "fact" && d.key === value.field,
            ),
        );
      } else if (tab === "creative")
        await command(
          "creative",
          "property-direction",
          "save",
          creativeSchema.parse(draft),
          editing ??
            view?.documents.find(
              (d) => d.kind === "creative" && d.key === "property-direction",
            ),
        );
      else if (tab === "decisions")
        await command(
          "recommendation",
          editing?.key ?? (draftKey.current ??= crypto.randomUUID()),
          editing?.status === "implemented" ? "measure" : "save",
          recommendationSchema.parse(draft),
          editing ?? undefined,
        );
      else if (tab === "experiments")
        await command(
          "experiment",
          editing?.key ?? (draftKey.current ??= crypto.randomUUID()),
          "save",
          experimentSchema.parse(draft),
          editing ?? undefined,
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function retrieve(provider: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retrieve",
          propertyId,
          provider,
          start,
          end,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setPreview(body.preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const frozen =
    !!editing &&
    (editing.status === "measured" ||
      (editing.kind === "experiment" && editing.status === "approved"));
  const kind: Kind =
    tab === "facts"
      ? "fact"
      : tab === "creative"
        ? "creative"
        : tab === "decisions"
          ? "recommendation"
          : tab === "experiments"
            ? "experiment"
            : "batch";
  return (
    <div className={`${styles.surface} space-y-6 text-gray-900`}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Property intelligence
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Review the facts behind your websites, connect evidence, and
          understand the results. Project coordination stays in Basecamp.
        </p>
      </header>
      <nav aria-label="Intelligence sections" className="flex flex-wrap gap-2">
        {[
          ["facts", "Property record"],
          ["creative", "Creative direction"],
          ["sources", "Data sources"],
          ["insights", "Insights"],
          ["decisions", "Recommendations"],
          ["experiments", "Experiments"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => changeTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`rounded-lg border px-4 py-2 text-sm ${tab === id ? "bg-gray-900 text-white" : "bg-white"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="console-error">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg bg-green-50 p-3 text-sm text-green-900"
        >
          {message}
        </p>
      )}
      {!view && !error && <p role="status">Loading property records…</p>}
      {tab === "insights" ? (
        <InsightsView />
      ) : (
        view && (
          <>
            {tab === "sources" ? (
              <section className="console-panel p-6">
                <h2 className="text-xl font-semibold">Review a data import</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Source connections are activated separately. Fetching prepares
                  a preview; only approved imports appear in analytics.
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label>
                    From
                    <input
                      type="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      className={input}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      className={input}
                    />
                  </label>
                </div>
                <div className="mt-5 space-y-3">
                  {view.connections.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div>
                        <strong>{c.name}</strong>
                        <p className="text-xs text-gray-500">
                          {c.configured
                            ? "Ready to retrieve a review preview"
                            : "Account activation deferred"}
                        </p>
                      </div>
                      <button
                        disabled={busy || !c.configured || !view.canManage}
                        className="console-action"
                        onClick={() => void retrieve(c.id)}
                      >
                        Prepare import
                      </button>
                    </div>
                  ))}
                </div>
                <details className="mt-5">
                  <summary className="cursor-pointer font-medium">
                    Import a prepared observation file
                  </summary>
                  <p className="mt-2 text-sm text-gray-600">
                    Use the supplied CSV template for daily website, product or
                    experiment observations. No names, contact details or
                    session identifiers.
                  </p>
                  <a
                    className="mt-2 inline-block text-sm underline"
                    href="/api/intelligence/template"
                  >
                    Download observation template
                  </a>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label>
                      Source name
                      <input
                        className={input}
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      />
                    </label>
                    <label>
                      Source account label
                      <input
                        className={input}
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                      />
                    </label>
                  </div>
                  <input
                    aria-label="Observation file"
                    type="file"
                    accept=".csv"
                    className="mt-4 text-sm"
                    disabled={!view.canManage}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2000000) {
                        setError("Choose a CSV smaller than 2 MB.");
                        return;
                      }
                      void file
                        .text()
                        .then(async (content) => {
                          const r = await fetch("/api/intelligence/import", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              propertyId,
                              source,
                              account,
                              content,
                            }),
                          });
                          const body = await r.json();
                          if (!r.ok) throw new Error(body.error);
                          setPreview(body.preview);
                        })
                        .catch((e) => setError(e.message));
                    }}
                  />
                </details>
                {preview && (
                  <div className="mt-5 rounded-lg border border-amber-200 p-4">
                    <h3 className="font-semibold">Preview: {preview.source}</h3>
                    <p className="mt-2 text-sm">
                      {preview.rows.length} observations · {preview.start}–
                      {preview.end}
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {preview.limitations.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    <div className="mt-3 max-h-60 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <tbody>
                          {preview.rows.slice(0, 100).map((r) => (
                            <tr key={r.key}>
                              <td className="p-1">{r.date}</td>
                              <td className="p-1">{r.metric}</td>
                              <td className="p-1">{r.value}</td>
                              <td className="p-1">{r.device}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-500">
                      Preview shows up to 100 rows. Approving this import
                      replaces this account’s observations in the same date
                      window.
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-sm underline"
                      onClick={() => downloadBatch(preview)}
                    >
                      Download every observation for review
                    </button>
                    <button
                      disabled={busy}
                      className="console-action mt-4"
                      onClick={() =>
                        void command(
                          "batch",
                          `${preview.provider}:${preview.start}:${preview.end}:${encodeURIComponent(preview.account).replaceAll("%", "").slice(0, 70)}`,
                          "save",
                          batchSchema.parse(preview),
                          view.documents.find(
                            (d) =>
                              d.kind === "batch" &&
                              (d.payload as Batch).account ===
                                preview.account &&
                              (d.payload as Batch).provider ===
                                preview.provider &&
                              (d.payload as Batch).start === preview.start &&
                              (d.payload as Batch).end === preview.end,
                          ),
                        )
                      }
                    >
                      Save import for review
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <form onSubmit={save} className="console-panel space-y-5 p-6">
                <h2 className="text-xl font-semibold">
                  {frozen
                    ? "Saved review"
                    : editing
                      ? editing.status === "implemented"
                        ? "Record observed result"
                        : "Edit saved draft"
                      : tab === "facts"
                        ? "Add or review a property fact"
                        : tab === "creative"
                          ? "Designer’s creative direction"
                          : tab === "decisions"
                            ? "Propose a measured improvement"
                            : "Register a controlled experiment"}
                </h2>
                {frozen && (
                  <p className="text-sm text-gray-600">
                    This reviewed decision is retained and cannot be
                    overwritten.
                  </p>
                )}
                {editing &&
                  ["recommendation", "experiment"].includes(editing.kind) && (
                    <button
                      className="console-action"
                      type="button"
                      onClick={() => changeTab(tab)}
                    >
                      Create another {editing.kind}
                    </button>
                  )}
                <fieldset
                  disabled={busy || !view.canManage || frozen}
                  className="space-y-5"
                >
                  {tab === "facts" ? (
                    <>
                      <label className="block text-sm font-medium">
                        Property field
                        <select
                          className={input}
                          value={String(draft.field)}
                          onChange={(e) => {
                            const d = view.documents.find(
                              (d) =>
                                d.kind === "fact" && d.key === e.target.value,
                            );
                            setEditing(d ?? null);
                            setDraft(
                              d
                                ? { ...(d.payload as Record<string, unknown>) }
                                : { ...blankFact(), field: e.target.value },
                            );
                          }}
                        >
                          {Object.entries(fieldRegistry).map(
                            ([k, [label, group]]) => (
                              <option key={k} value={k}>
                                {group} — {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      {field("value", "Approved information", "textarea", true)}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {field(
                          "source",
                          "Who or what supplied this?",
                          "text",
                          true,
                        )}
                        {field("sourceUrl", "Source link", "url")}
                        {field("observedAt", "Information as of", "date", true)}
                        {field("reviewAfter", "Review again by", "date", true)}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {["effectiveFrom", "effectiveTo"].map((k, i) => (
                          <label key={k} className="text-sm">
                            {i
                              ? "Effective until (optional)"
                              : "Effective from (optional)"}
                            <input
                              type="date"
                              className={input}
                              value={String(draft[k] ?? "")}
                              onChange={(e) => patch(k, e.target.value || null)}
                            />
                          </label>
                        ))}
                      </div>
                      <label className="block text-sm">
                        Visibility
                        <select
                          className={input}
                          value={String(draft.visibility)}
                          onChange={(e) => patch("visibility", e.target.value)}
                        >
                          <option value="public">
                            Public — website and client view
                          </option>
                          <option value="portal">Client view only</option>
                          <option value="internal">Internal only</option>
                        </select>
                      </label>
                      <label className="block text-sm">
                        Information origin
                        <select
                          className={input}
                          value={String(draft.origin)}
                          onChange={(e) => patch("origin", e.target.value)}
                        >
                          <option value="staff">Team review</option>
                          <option value="client">Client supplied</option>
                          <option value="import">Imported source</option>
                          <option value="ai_suggested">
                            AI suggestion — requires human approval
                          </option>
                        </select>
                      </label>
                      <p className="text-xs text-gray-500">
                        Draft, expired, private and overdue facts are excluded
                        from website generation. Existing floorplans, media and
                        legal information continue to use their own review
                        screens.
                      </p>
                    </>
                  ) : null}
                  {tab === "creative" ? (
                    <>
                      {field("title", "Direction name", "text", true)}
                      {field("thesis", "Creative concept", "textarea", true)}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {[
                          ["typography", "Typography and hierarchy"],
                          ["palette", "Color use"],
                          ["imagery", "Image treatment"],
                          ["spacing", "Spacing and density"],
                          ["motion", "Motion and interaction"],
                          ["hero", "Opening experience"],
                          ["pageRhythm", "Page rhythm"],
                          ["voice", "Messaging tone"],
                        ].map(([k, l]) => field(k, l, "textarea"))}
                      </div>
                      {field(
                        "exceptions",
                        "Intentional departures from standard components",
                        "textarea",
                      )}
                      <label className="block text-sm">
                        Reference links (one per line)
                        <textarea
                          className={input}
                          value={((draft.references as string[]) ?? []).join(
                            "\n",
                          )}
                          onChange={(e) =>
                            patch(
                              "references",
                              e.target.value.split("\n").filter(Boolean),
                            )
                          }
                        />
                      </label>
                      <div>
                        <h3 className="font-medium">P11 component guidance</h3>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {componentGuides.map((c) => (
                            <label
                              key={c.id}
                              className="rounded-lg border p-3 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={(
                                  (draft.componentKeys as string[]) ?? []
                                ).includes(c.id)}
                                onChange={(e) =>
                                  patch(
                                    "componentKeys",
                                    e.target.checked
                                      ? [
                                          ...((draft.componentKeys as string[]) ??
                                            []),
                                          c.id,
                                        ]
                                      : (
                                          draft.componentKeys as string[]
                                        ).filter((k) => k !== c.id),
                                  )
                                }
                                className="mr-2"
                              />
                              {c.label}
                              <span className="mt-1 block text-xs text-gray-500">
                                {c.conversionIntent}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        Approve this direction to include it in the next Astra
                        website generation.
                      </p>
                    </>
                  ) : null}
                  {tab === "decisions" ? (
                    <>
                      {field("title", "Recommendation", "text", true)}
                      {field(
                        "rationale",
                        "Observation and possible explanation",
                        "textarea",
                        true,
                      )}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {field(
                          "owner",
                          "Responsible team member",
                          "text",
                          true,
                        )}
                        {field(
                          "targetMetric",
                          "Measure to improve",
                          "text",
                          true,
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="text-sm">
                          Product area
                          <select
                            className={input}
                            value={String(draft.executionType)}
                            onChange={(e) =>
                              patch("executionType", e.target.value)
                            }
                          >
                            {[
                              "website",
                              "media",
                              "content",
                              "search",
                              "data",
                              "operations",
                            ].map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm">
                          Evidence confidence
                          <select
                            className={input}
                            value={String(draft.confidence)}
                            onChange={(e) =>
                              patch("confidence", e.target.value)
                            }
                          >
                            {["low", "medium", "high"].map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {field(
                        "expectedImpact",
                        "Expected effect and uncertainty",
                        "textarea",
                      )}
                      {field(
                        "rollback",
                        "How to reverse the change",
                        "textarea",
                      )}
                      {field(
                        "basecampUrl",
                        "Basecamp task link (optional)",
                        "url",
                      )}
                      <label className="block text-sm">
                        Evidence (one source or saved report reference per line)
                        <textarea
                          className={input}
                          required
                          value={(
                            (draft.evidence as Array<{
                              reference: string;
                            }>) ?? []
                          )
                            .map((x) => x.reference)
                            .join("\n")}
                          onChange={(e) =>
                            patch(
                              "evidence",
                              e.target.value
                                .split("\n")
                                .filter(Boolean)
                                .map((reference) => ({
                                  label: reference.slice(0, 200),
                                  reference: reference.slice(0, 200),
                                  observedAt: new Date().toISOString(),
                                })),
                            )
                          }
                        />
                      </label>
                      {eventField(
                        "releaseEvent",
                        "Action that put this improvement into practice",
                      )}
                      {eventField(
                        "measurementEvent",
                        "Action recording the observed outcome",
                      )}
                      {field(
                        "result",
                        "Observed result and limitations",
                        "textarea",
                      )}
                    </>
                  ) : null}
                  {tab === "experiments" ? (
                    <>
                      <p className="text-sm text-gray-600">
                        Register the measurement plan at least one calendar day
                        before the test starts. Delivery and randomized
                        assignment happen in the relevant product. This screen
                        evaluates reviewed results; it does not launch changes.
                      </p>
                      {field("title", "Experiment title", "text", true)}
                      {field("hypothesis", "Hypothesis", "textarea", true)}
                      {field(
                        "assignmentReference",
                        "Random assignment method and evidence",
                        "textarea",
                        true,
                      )}
                      <label className="block text-sm">
                        Primary outcome
                        <select
                          className={input}
                          value={String(draft.metric)}
                          onChange={(e) => patch("metric", e.target.value)}
                        >
                          <option value="tour_completions">
                            Tour completions per session
                          </option>
                          <option value="form_completions">
                            Form completions per session
                          </option>
                        </select>
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {field("start", "Start date", "date", true)}
                        {field("end", "End date", "date", true)}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="text-sm">
                          Minimum sessions per group
                          <input
                            type="number"
                            min={30}
                            className={input}
                            value={Number(draft.minimumPerArm)}
                            onChange={(e) =>
                              patch("minimumPerArm", Number(e.target.value))
                            }
                          />
                        </label>
                        <label className="text-sm">
                          Minimum absolute effect (0.02 = 2 percentage points)
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className={input}
                            value={Number(draft.minimumEffect)}
                            onChange={(e) =>
                              patch("minimumEffect", Number(e.target.value))
                            }
                          />
                        </label>
                      </div>
                      {field(
                        "guardrail",
                        "Guardrails and stop conditions",
                        "textarea",
                        true,
                      )}
                      {eventField(
                        "releaseEvent",
                        "Confirmed setup or release action",
                        true,
                      )}
                      {field(
                        "confounders",
                        "Other changes that may affect the result",
                        "textarea",
                      )}
                      {field("notes", "Review notes", "textarea")}
                    </>
                  ) : null}
                  <label className="block text-sm">
                    Reason for this decision
                    <input
                      className={input}
                      required
                      minLength={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button className="console-action-primary" type="submit">
                    {busy
                      ? "Saving…"
                      : editing?.status === "implemented"
                        ? "Record measured result"
                        : "Save draft"}
                  </button>
                </fieldset>
              </form>
            )}
            <section className="console-panel p-6">
              <h2 className="text-xl font-semibold">
                Saved{" "}
                {tab === "facts"
                  ? "facts"
                  : tab === "sources"
                    ? "imports"
                    : tab === "decisions"
                      ? "recommendations"
                      : tab}
              </h2>
              <div className="mt-4 space-y-3">
                {view.documents
                  .filter((d) => d.kind === kind)
                  .map((d) => (
                    <article key={d.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-medium">
                            {d.kind === "fact"
                              ? (fieldRegistry[
                                  d.key as keyof typeof fieldRegistry
                                ]?.[0] ?? d.key)
                              : String(
                                  (d.payload as Record<string, unknown>)
                                    .title ??
                                    (d.payload as Record<string, unknown>)
                                      .source ??
                                    d.key,
                                )}
                          </h3>
                          <p className="mt-1 text-xs text-gray-500">
                            {d.status} · Version {d.revision}
                            {d.locked ? " · Locked" : ""} ·{" "}
                            {d.updated_at.slice(0, 10)}
                          </p>
                          {d.kind === "experiment" && (
                            <p className="mt-1 select-all text-xs text-gray-500">
                              Experiment reference: {d.id}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {view.canManage && (
                            <>
                              {d.kind === "batch" && (
                                <button
                                  className="console-action"
                                  onClick={() =>
                                    downloadBatch(batchSchema.parse(d.payload))
                                  }
                                >
                                  Review observations
                                </button>
                              )}
                              {d.kind !== "batch" && (
                                <button
                                  className="console-action"
                                  onClick={() => open(d)}
                                >
                                  Review / edit
                                </button>
                              )}
                              {d.status === "draft" && (
                                <button
                                  disabled={busy}
                                  className="console-action"
                                  onClick={() =>
                                    void command(
                                      d.kind,
                                      d.key,
                                      "approve",
                                      undefined,
                                      d,
                                    )
                                  }
                                >
                                  Approve
                                </button>
                              )}
                              {["draft", "approved"].includes(d.status) && (
                                <button
                                  disabled={busy}
                                  className="console-action"
                                  onClick={() =>
                                    void command(
                                      d.kind,
                                      d.key,
                                      "withdraw",
                                      undefined,
                                      d,
                                    )
                                  }
                                >
                                  Withdraw
                                </button>
                              )}
                              {["fact", "creative"].includes(d.kind) && (
                                <button
                                  disabled={busy}
                                  className="console-action"
                                  onClick={() =>
                                    void command(
                                      d.kind,
                                      d.key,
                                      d.locked ? "unlock" : "lock",
                                      undefined,
                                      d,
                                    )
                                  }
                                >
                                  {d.locked ? "Unlock" : "Lock"}
                                </button>
                              )}
                              {d.kind === "experiment" &&
                                d.status === "approved" && (
                                  <button
                                    disabled={busy}
                                    className="console-action"
                                    onClick={() =>
                                      void command(
                                        d.kind,
                                        d.key,
                                        "measure",
                                        undefined,
                                        d,
                                      )
                                    }
                                  >
                                    Review measured result
                                  </button>
                                )}
                              {d.kind === "recommendation" &&
                                d.status === "approved" && (
                                  <button
                                    disabled={busy}
                                    className="console-action"
                                    onClick={() =>
                                      void command(
                                        d.kind,
                                        d.key,
                                        "implement",
                                        undefined,
                                        d,
                                      )
                                    }
                                  >
                                    Record implementation
                                  </button>
                                )}
                            </>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                        {String(
                          (d.payload as Record<string, unknown>).value ??
                            (d.payload as Record<string, unknown>).thesis ??
                            (d.payload as Record<string, unknown>).rationale ??
                            (d.payload as Record<string, unknown>).hypothesis ??
                            "Reviewed source observations",
                        )}
                      </p>
                      {d.kind === "batch" && (
                        <p className="mt-2 text-sm">
                          {(d.payload as Batch).rows.length} observations ·{" "}
                          {(d.payload as Batch).start}–
                          {(d.payload as Batch).end}
                        </p>
                      )}
                    </article>
                  ))}
                {!view.documents.some((d) => d.kind === kind) && (
                  <p className="text-sm text-gray-500">No saved items yet.</p>
                )}
              </div>
            </section>
            {tab === "creative" && (
              <section className="console-panel p-6">
                <h2 className="text-xl font-semibold">
                  Website delivery formats
                </h2>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {publishingTargets.map((t) => (
                    <div key={t.id} className="rounded-xl border p-4">
                      <h3 className="font-medium">{t.name}</h3>
                      <p className="mt-2 text-xs uppercase tracking-wide text-gray-500">
                        {t.status}
                      </p>
                      <p className="mt-2 text-sm leading-6">{t.detail}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-4">
                  <Link href="/dashboard/siteforge" className="underline">
                    Generate with Astra
                  </Link>
                  <a
                    href={`/api/intelligence?kind=webflow&propertyId=${propertyId}`}
                    download
                    className="underline"
                  >
                    Export approved Webflow content
                  </a>
                </div>
              </section>
            )}
            <details className="console-panel p-6">
              <summary className="cursor-pointer font-medium">
                Recent decisions
              </summary>
              <ul className="mt-4 space-y-2 text-sm">
                {view.history.map((h) => (
                  <li key={h.id}>
                    {h.created_at.slice(0, 16).replace("T", " ")} ·{" "}
                    {h.input.kind} · {h.input.operation} — {h.input.reason}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )
      )}
    </div>
  );
}
