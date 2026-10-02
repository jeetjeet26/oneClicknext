import type { PortalData } from "@/utils/client-portal/contracts";
import { FunnelSummary } from "./FunnelSummary";
const labels: Record<string, string> = {
  spend: "Marketing spend",
  clicks: "Clicks",
  impressions: "Impressions",
  conversions: "Reported conversions",
  cpc: "Cost per click",
  cpa: "Cost per reported conversion",
  ctr: "Click-through rate",
};
export function ClientProgress({ data }: { data: PortalData }) {
  return (
    <>
      <section className="console-panel mb-6 p-5 sm:p-6">
        <div className="flex flex-wrap justify-between gap-3">
          <h2 className="text-lg font-medium">How this period compares</h2>
          <span className="text-xs text-slate-500">
            Previous {data.period.days} days
          </span>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {(["spend", "clicks", "impressions"] as const).map((k) => {
            const change = data.comparison?.changes[k];
            return (
              <div key={k}>
                <p className="text-xs text-slate-500">{labels[k]}</p>
                <p className="mt-2 text-2xl font-medium">
                  {change == null
                    ? "Not comparable"
                    : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {change == null
                    ? "A comparable, nonzero baseline is not available"
                    : "Change in recorded totals"}
                </p>
              </div>
            );
          })}
        </div>
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-slate-600">
            Data coverage and freshness
          </summary>
          <p className="my-3 text-xs leading-5 text-slate-500">
            Coverage reflects dates with stored marketing records. It does not
            prove all provider data has arrived. A refreshed page may still
            contain older source data.
          </p>
          {data.coverage?.map((c) => (
            <p key={c.propertyId} className="my-2 text-sm">
              {c.propertyName}: {c.observedDays} of {c.requestedDays} dates with
              records ·{" "}
              {c.latestDate
                ? "Latest date: " + c.latestDate
                : "Awaiting marketing data"}
            </p>
          ))}
        </details>
        {!!data.goals?.length && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-medium">Agreed goals</h3>
            {data.goals.map((g, i) => (
              <p key={i} className="mt-2 text-sm text-slate-600">
                {g.propertyName} · {labels[g.metric] ?? g.metric}:{" "}
                {g.target.toLocaleString()} ({g.type.replaceAll("_", " ")})
              </p>
            ))}
            <p className="mt-2 text-xs text-slate-500">
              Goals are shown as configured by your team; their reporting
              periods may differ from the dates above.
            </p>
          </div>
        )}
      </section>
      {data.funnel && (
        <FunnelSummary current={data.funnel} previous={data.previousFunnel} />
      )}
    </>
  );
}
