"use client";
import {
  useEffect,
  useState,
  useId,
  cloneElement,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  stages,
  type Workspace,
  type Outcome,
  type OutcomeInput,
  type DeliveryReport,
} from "@/utils/delivery/contracts";
import { parseOutcomeCsv } from "@/utils/delivery/model";
import { buildBiReport, type BiReport } from "@/utils/analytics/report-data";
import { button, primary, field, panel, type Save } from "./styles";
import { FunnelSummary } from "@/components/client-portal/FunnelSummary";
type Props = { data: Workspace; disabled: boolean; save: Save };
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const today = () => new Date().toISOString().slice(0, 10);
const date = (d: string) =>
  new Date(d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
function Label({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {text}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm leading-6 text-slate-500">
      {children}
    </p>
  );
}
export function OutcomesPanel({
  data,
  disabled,
  save,
  search,
  setSearch,
}: Props & { search: string; setSearch: (s: string) => void }) {
  const [preview, setPreview] = useState<OutcomeInput[]>([]),
    [csvError, setCsvError] = useState("");
  function template() {
    const csv =
      "lead_id,stage,occurred_on,reference\n" +
      (data.leads[0]
        ? `${data.leads[0].id},application,${today()},Replace with your source reference\n`
        : "");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "leasing-outcomes-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={panel}>
          <h2 className="text-lg font-medium">Record a leasing outcome</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Choose the existing inquiry and cite your source. Repeat records are
            checked before saving. This does not change lead status or trigger a
            follow-up.
          </p>
          <form
            className="my-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(value(new FormData(e.currentTarget), "search"));
            }}
          >
            <Label text="Find an inquiry">
              <input
                className={field}
                name="search"
                defaultValue={search}
                placeholder="Name or CRM reference"
                maxLength={100}
              />
            </Label>
            <button className={button} disabled={disabled}>
              Find
            </button>
          </form>
          <p className="text-xs text-slate-500">
            Showing up to 50 matching inquiries. Narrow your search to find an
            older record.
          </p>
          <OutcomeForm data={data} disabled={disabled} save={save} />
        </section>
        <section className={panel}>
          <h2 className="text-lg font-medium">Review an outcome import</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use the console inquiry ID, outcome, date and a source reference.
            The template includes one example to replace. Review up to 100 rows
            before saving; existing outcomes must be corrected individually.
          </p>
          <button type="button" className={button + " mt-3"} onClick={template}>
            Download CSV template
          </button>
          <Label text="Choose outcomes CSV">
            <input
              className={field}
              type="file"
              accept=".csv,text/csv"
              disabled={disabled}
              onChange={async (e) => {
                setCsvError("");
                setPreview([]);
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 65536)
                    throw Error("Use a file smaller than 64 KB.");
                  setPreview(parseOutcomeCsv(await file.text()));
                } catch (err) {
                  setCsvError(
                    err instanceof Error ? err.message : "Check the file.",
                  );
                }
              }}
            />
          </Label>
          {csvError && (
            <p role="alert" className="mt-3 text-sm text-amber-900">
              {csvError}
            </p>
          )}
          {preview.length > 0 && (
            <>
              <p className="my-3 text-sm font-medium">
                {preview.length} rows ready for your review
              </p>
              <div className="max-h-64 overflow-auto">
                <table className="console-table">
                  <thead>
                    <tr>
                      <th>Inquiry</th>
                      <th>Outcome</th>
                      <th>Date</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.leadId + ":" + r.stage}>
                        <td className="break-all">
                          {data.leads.find((l) => l.id === r.leadId)?.name ??
                            r.leadId}
                        </td>
                        <td>{stages[r.stage]}</td>
                        <td>{r.occurredOn}</td>
                        <td>{r.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className={primary + " mt-4"}
                disabled={disabled}
                onClick={async () => {
                  if (await save({ operation: "outcomes", rows: preview }))
                    setPreview([]);
                }}
              >
                Save reviewed outcomes
              </button>
            </>
          )}
        </section>
      </div>
      <h2 className="text-lg font-medium">
        Recorded outcomes ({data.outcomeTotal})
      </h2>
      {!data.outcomes.length && (
        <Empty>
          No staff-reported outcomes on this page. Native tour bookings are
          already included in the cohort above.
        </Empty>
      )}
      {data.outcomes.map((o) => (
        <article className={panel} key={o.id}>
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-medium">
              {o.lead_name || "Inquiry"} · {stages[o.stage]}
            </h3>
            <span className="text-xs text-slate-500">
              {o.state === "withdrawn" ? "Withdrawn · " : ""}
              {date(o.occurred_on)}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">{o.reference}</p>
          <p className="mt-1 text-xs text-slate-500">
            {o.source === "reviewed_import"
              ? "Reviewed import"
              : "Staff report"}{" "}
            · revision {o.revision}
          </p>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer">
              Correct or withdraw this outcome
            </summary>
            <OutcomeForm
              key={o.revision}
              data={data}
              disabled={disabled}
              save={save}
              item={o}
            />
            {o.state === "active" && (
              <form
                className="mt-4 border-t border-slate-100 pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({
                    operation: "outcome_withdraw",
                    targetId: o.id,
                    revision: o.revision,
                    reason: value(new FormData(e.currentTarget), "reason"),
                  });
                }}
              >
                <Label text="Reason for withdrawal">
                  <input
                    className={field}
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    required
                    disabled={disabled}
                  />
                </Label>
                <button className={button + " mt-3"} disabled={disabled}>
                  Withdraw outcome
                </button>
              </form>
            )}
          </details>
        </article>
      ))}
    </div>
  );
}
function OutcomeForm({
  data,
  disabled,
  save,
  item,
}: Props & { item?: Outcome }) {
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = new FormData(form);
        if (
          await save({
            operation: "outcomes",
            rows: [
              {
                leadId: item?.lead_id ?? value(f, "leadId"),
                stage:
                  item?.stage ?? (value(f, "stage") as OutcomeInput["stage"]),
                occurredOn: value(f, "occurredOn"),
                source: "staff_reported",
                reference: value(f, "reference"),
                revision: item?.revision ?? null,
                reason: value(f, "reason"),
              },
            ],
          })
        )
          if (!item) form.reset();
      }}
    >
      <fieldset className="space-y-4" disabled={disabled}>
        {!item && (
          <>
            <Label text="Inquiry">
              <select className={field} name="leadId" required defaultValue="">
                <option value="">Choose an inquiry</option>
                {data.leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name || "Unnamed inquiry"} · {date(l.created_at)} ·{" "}
                    {l.source || "Unknown source"}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Outcome">
              <select className={field} name="stage">
                {Object.entries(stages).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Label>
          </>
        )}
        <Label text="Outcome date">
          <input
            className={field}
            type="date"
            name="occurredOn"
            defaultValue={item?.occurred_on ?? data.funnel.end}
            max={data.funnel.end}
            required
          />
        </Label>
        <Label text="Source reference">
          <input
            className={field}
            name="reference"
            defaultValue={item?.reference ?? ""}
            placeholder="For example: reviewed CRM record or leasing report"
            minLength={3}
            maxLength={500}
            required
          />
        </Label>
        <p className="text-xs text-slate-500">
          Use a record reference, not private applicant documents or financial
          details.
        </p>
        {item && (
          <Label text="Reason for correction">
            <textarea
              className={field}
              name="reason"
              minLength={3}
              maxLength={1000}
              rows={2}
              required
            />
          </Label>
        )}
        <button className={primary}>
          {item ? "Save correction" : "Save outcome"}
        </button>
      </fieldset>
    </form>
  );
}
export function ReportsPanel({ data, disabled, save }: Props) {
  const prior = new Date(data.funnel.end + "T12:00:00Z");
  prior.setUTCDate(1);
  prior.setUTCMonth(prior.getUTCMonth() - 1);
  return (
    <div className="space-y-5">
      <section className={panel}>
        <h2 className="text-lg font-medium">
          A monthly report, ready for review
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          A draft captures recorded marketing results, leasing outcomes and
          goals. Add a plain-language explanation and summarize relevant work
          from Basecamp, then review and publish the report to assigned clients.
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              operation: "report_draft",
              month: value(new FormData(e.currentTarget), "month"),
            });
          }}
        >
          <Label text="Reporting month">
            <input
              className={field}
              type="month"
              name="month"
              max={prior.toISOString().slice(0, 7)}
              defaultValue={prior.toISOString().slice(0, 7)}
              required
              disabled={disabled}
            />
          </Label>
          <button className={primary} disabled={disabled}>
            Prepare monthly draft
          </button>
        </form>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium">
            Monthly draft preparation:{" "}
            {data.policy?.enabled ? "Requested" : "Off"}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Prepares the last completed month when the reporting service runs.
            Every draft still needs staff review and publication.{" "}
            {(data as Workspace & { draftAutomationAvailable?: boolean })
              .draftAutomationAvailable
              ? "The reporting service is enabled."
              : "Scheduled drafting awaits service activation; you can prepare drafts above."}
          </p>
          <button
            className={button + " mt-3"}
            disabled={disabled}
            onClick={() =>
              void save({
                operation: "report_policy",
                revision: data.policy?.revision ?? null,
                enabled: !data.policy?.enabled,
              })
            }
          >
            {data.policy?.enabled
              ? "Turn off monthly drafting"
              : "Request monthly drafts"}
          </button>
        </div>
      </section>
      <h2 className="text-lg font-medium">Reports ({data.reportTotal})</h2>
      {!data.reports.length && (
        <Empty>No client reports have been prepared for this property.</Empty>
      )}
      {data.reports.map((r) => (
        <ReportCard
          key={r.id + ":" + r.revision}
          data={data}
          report={r}
          disabled={disabled}
          save={save}
        />
      ))}
    </div>
  );
}
function ReportCard({
  data,
  report: r,
  disabled,
  save,
}: Props & { report: DeliveryReport }) {
  const [preview, setPreview] = useState<BiReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      "/api/delivery?" +
        new URLSearchParams({ propertyId: data.propertyId, reportId: r.id }),
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const d = await response.json();
        if (
          !response.ok ||
          d.propertyId !== data.propertyId ||
          d.report?.revision !== r.revision
        )
          throw Error(d.error || "Report changed. Refresh before review.");
        setPreview(buildBiReport(d.source));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [data.propertyId, r.id, r.revision]);
  return (
    <article className={panel}>
      <div className="flex justify-between gap-3">
        <h3 className="text-lg font-medium">
          {new Date(r.month + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">
          {r.state}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Captured {date(r.evidence.capturedAt)} · revision {r.revision}
        {r.published_at ? " · Published " + date(r.published_at) : ""}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-900">
          {error}
        </p>
      )}
      {preview ? (
        <>
          <div className="my-5 grid gap-4 sm:grid-cols-3">
            <p className="text-sm">
              <span className="block text-xs text-slate-500">
                Recorded spend
              </span>
              {preview.coverage.records
                ? preview.totals.spend === null
                  ? "Currency unavailable"
                  : `$${preview.totals.spend.toFixed(2)} USD`
                : "No data"}
            </p>
            <p className="text-sm">
              <span className="block text-xs text-slate-500">Clicks</span>
              {preview.totals.clicks.toLocaleString()}
            </p>
            <p className="text-sm">
              <span className="block text-xs text-slate-500">
                Marketing coverage
              </span>
              {preview.coverage.observedDays} / {preview.coverage.requestedDays}{" "}
              dates with records
            </p>
          </div>
          <details className="mb-5 text-sm">
            <summary className="cursor-pointer">
              Source coverage and previous period
            </summary>
            <p className="my-2 text-xs text-slate-500">
              {preview.comparison?.previousPeriod?.start}–
              {preview.comparison?.previousPeriod?.end}:{" "}
              {preview.comparison?.totals.clicks ?? 0} clicks. Missing dates and
              conversions do not establish complete provider or leasing
              coverage.
            </p>
            {preview.coverage.sources.map((s, i) => (
              <p className="my-1" key={i}>
                {s.channel}: {s.firstDate}–{s.lastDate}, {s.days} observed dates
              </p>
            ))}
          </details>
        </>
      ) : (
        <p className="my-5 text-sm text-slate-500">
          Loading saved report evidence…
        </p>
      )}
      <FunnelSummary
        current={r.evidence.funnel}
        previous={r.evidence.previousFunnel}
      />
      {r.evidence.completedWork.length > 0 && (
        <section className="mb-4">
          <h4 className="text-sm font-medium">Completed work in this report</h4>
          {r.evidence.completedWork.map((w) => (
            <p className="mt-2 text-sm" key={w.id}>
              {w.title}: {w.summary}
            </p>
          ))}
        </section>
      )}
      {r.evidence.goals.length > 0 && (
        <p className="mb-4 text-sm">
          Goals captured:{" "}
          {r.evidence.goals
            .map((g) => `${g.metric}: ${g.target} (${g.type})`)
            .join(" · ")}
        </p>
      )}
      {r.state === "published" ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-6">{r.summary}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
            <strong>Next steps:</strong> {r.next_steps}
          </p>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              operation: "report_edit",
              targetId: r.id,
              revision: r.revision,
              summary: value(f, "summary"),
              nextSteps: value(f, "nextSteps"),
            });
          }}
        >
          <Label text="What the results mean for your client">
            <textarea
              className={field}
              rows={4}
              name="summary"
              defaultValue={r.summary}
              minLength={10}
              maxLength={4000}
              required
              disabled={disabled}
            />
          </Label>
          <Label text="Next steps for the coming month">
            <textarea
              className={field}
              rows={2}
              name="nextSteps"
              defaultValue={r.next_steps}
              minLength={3}
              maxLength={2000}
              required
              disabled={disabled}
            />
          </Label>
          <button className={button} disabled={disabled}>
            Save report narrative
          </button>
        </form>
      )}
      <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
        {r.state === "draft" && (
          <button
            className={primary}
            disabled={disabled || !preview || r.summary.length < 10}
            onClick={() =>
              void save({
                operation: "report_transition",
                targetId: r.id,
                revision: r.revision,
                status: "approved",
              })
            }
          >
            Approve this version
          </button>
        )}
        {r.state === "approved" && (
          <button
            className={primary}
            disabled={disabled || !preview}
            onClick={() =>
              void save({
                operation: "report_transition",
                targetId: r.id,
                revision: r.revision,
                status: "published",
              })
            }
          >
            Publish to assigned clients
          </button>
        )}
        {["approved", "published"].includes(r.state) && (
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              void save({
                operation: "report_transition",
                targetId: r.id,
                revision: r.revision,
                status: "withdrawn",
              })
            }
          >
            Withdraw report
          </button>
        )}
        {["draft", "withdrawn"].includes(r.state) && (
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              void save({
                operation: "report_refresh",
                targetId: r.id,
                revision: r.revision,
              })
            }
          >
            Refresh captured results
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Only published reports appear in the client portal. Editing or
        refreshing a draft requires a new approval.
      </p>
    </article>
  );
}
