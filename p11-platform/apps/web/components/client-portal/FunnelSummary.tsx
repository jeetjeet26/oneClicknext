import type { Funnel } from "@/utils/delivery/contracts";
const panel = "rounded-xl border border-slate-200 bg-white p-5 sm:p-6";
export function FunnelSummary({
  current,
  previous,
}: {
  current: Funnel;
  previous?: Funnel;
}) {
  return (
    <section className={panel + " mb-6"} aria-label="Inquiry outcomes">
      <h2 className="text-lg font-medium">From inquiry to lease</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Inquiry records created {current.start}–{current.end}, with outcomes
        recorded through the end of that period. Each record counts once per
        stage; missing stages are not assumed.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
        {(
          ["inquiries", "booked", "attended", "applications", "leases"] as const
        ).map((k) => (
          <div key={k}>
            <p className="text-xs text-slate-500">
              {
                {
                  inquiries: "Inquiries",
                  booked: "Tours booked",
                  attended: "Tours attended",
                  applications: "Reported applications",
                  leases: "Reported leases",
                }[k]
              }
            </p>
            <p className="mt-2 text-2xl font-medium">
              {current[k].toLocaleString()}
            </p>
            {previous && (
              <p className="mt-1 text-xs text-slate-500">
                {previous[k]} in the previous cohort
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        These are recorded results, not proof of complete CRM coverage.
        Duplicate people across systems may remain. Advertising conversions are
        reported separately.
      </p>
      {current.sources.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer">View inquiry sources</summary>
          <div className="mt-3 overflow-auto">
            <table className="console-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Inquiries</th>
                  <th>Tours booked</th>
                  <th>Applications</th>
                  <th>Leases</th>
                </tr>
              </thead>
              <tbody>
                {current.sources.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td>{s.inquiries}</td>
                    <td>{s.booked}</td>
                    <td>{s.applications}</td>
                    <td>{s.leases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
