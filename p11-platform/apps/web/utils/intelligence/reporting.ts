import type { RetainedObservation } from './analysis';
import type { Funnel } from '@/utils/delivery/contracts';

/** Keep source totals separate: a page/device breakdown is not another property total. */
export function periodMeasures(rows: RetainedObservation[], start: string, end: string) {
  const definitions = [
    ['sessions', 'Website visits', 'count'],
    ['applications', 'Reported applications', 'count'],
    ['signed_leases', 'Reported signed leases', 'count'],
    ['move_ins', 'Reported move-ins', 'count'],
    ['effective_rent', 'Effective rent', 'snapshot'],
    ['concession_weeks', 'Concession weeks', 'snapshot'],
    ['occupancy_percent', 'Occupancy (%)', 'snapshot'],
    ['new_supply_units', 'New supply units', 'snapshot'],
    ['renter_demand_index', 'Renter demand index', 'snapshot'],
    ['estimated_competitor_visits', 'Estimated competitor visits', 'snapshot'],
  ] as const;
  return definitions.map(([metric, label, aggregation]) => {
    const matching = rows.filter(r => r.metric === metric && r.date >= start && r.date <= end &&
      !r.attributionModel && r.variant === null && r.device === 'all' && r.floorplanId === null && r.page === null && r.channel === 'unknown');
    const groups = new Map<string, RetainedObservation[]>();
    for (const row of matching) {
      const key = JSON.stringify([row.provider, row.account]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const sources = [...groups.values()].map(rs => {
      const latest = rs.map(r => r.date).sort().at(-1)!;
      const used = aggregation === 'snapshot' ? rs.filter(r => r.date === latest) : rs;
      // Multiple snapshots at the same grain are ambiguous; do not invent an average.
      const value = aggregation === 'snapshot' && used.length !== 1 ? null : used.reduce((n, r) => n + r.value, 0);
      return { source: rs[0].source, unit: used[0].unit ?? null, definition: used[0].definition ?? null, value, latest, observedDays: new Set(rs.map(r => r.date)).size,
        references: [...new Set(used.map(r => r.reference).filter(Boolean))] };
    });
    return { metric, label, aggregation, sources, status: sources.length ? 'Source observations' : 'Source data required' };
  });
}

export function funnelRates(funnel: Funnel) {
  const stages = [
    ['Inquiry to booked tour', funnel.booked, funnel.inquiries],
    ['Booked to attended tour', funnel.attended, funnel.booked],
    ['Attended tour to application', funnel.applications, funnel.attended],
    ['Application to reported lease', funnel.leases, funnel.applications],
  ] as const;
  return stages.map(([label, outcomes, starting]) => ({ label, outcomes, starting,
    // Separately observed stages do not prove each person passed through both.
    ratio: starting > 0 && outcomes <= starting ? outcomes / starting : null,
  }));
}

/** Imported attribution is reported per source account and model, never inferred from lead.source. */
export function leaseAttribution(rows: RetainedObservation[], start: string, end: string) {
  const groups = new Map<string, RetainedObservation[]>();
  for (const row of rows) {
    if (row.metric !== 'signed_leases' || row.date < start || row.date > end || !row.attributionModel ||
        row.verification !== 'source_confirmed' || !row.outcomeId || row.value !== 1) continue;
    const key = JSON.stringify([row.provider, row.account, row.attributionModel]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(rs => {
    const outcomes = new Map<string, RetainedObservation[]>();
    for (const r of rs) outcomes.set(r.outcomeId!, [...(outcomes.get(r.outcomeId!) ?? []), r]);
    const channels = new Map<string, number>();
    let unknown = 0, conflicting = 0;
    for (const records of outcomes.values()) {
      const sources = new Set(records.map(r => r.channel.trim().toLowerCase()));
      if (sources.size !== 1 || new Set(records.map(r => r.date)).size !== 1) { conflicting++; continue; }
      const channel = [...sources][0];
      if (!channel || channel === 'unknown') { unknown++; continue; }
      channels.set(channel, (channels.get(channel) ?? 0) + 1);
    }
    const total = outcomes.size;
    const matched = total - unknown - conflicting;
    return { source: rs[0].source, model: rs[0].attributionModel!, total, matched, unknown, conflicting,
      coverage: total ? matched / total : null,
      channels: [...channels].map(([channel, leases]) => ({ channel, leases })) };
  });
}

/** Descriptive spending ratios only; no claim that period spend caused cohort outcomes. */
export function spendingRatios(spend: number | null, usable: boolean, funnel: Funnel) {
  return ([['recorded inquiry', funnel.inquiries], ['booked tour', funnel.booked], ['reported application', funnel.applications], ['reported lease', funnel.leases]] as const)
    .map(([label, count]) => ({ label, value: usable && spend !== null && count > 0 ? spend / count : null }));
}
