'use client'

import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMarketingChannelLabel } from '@/utils/analytics/channel-identity'
import { formatConversions } from '@/utils/analytics/marketing-fact'
import { biChannelTrend, metricCurrency, metricPercent, type BiReport, type BiTotals } from '@/utils/analytics/report-data'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const moneyTicks = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const percentTicks = (value: number) => `${compact.format(value)}%`
const numberLabel = (value: number | null) => value?.toLocaleString() ?? 'Not available'
const conversionLabel = (value: number | null) => value === null ? 'Not available' : formatConversions(value)
const metrics = [
  { key: 'spend', title: 'Spend', format: metricCurrency, ticks: moneyTicks.format },
  { key: 'impressions', title: 'Impressions', format: numberLabel, ticks: compact.format },
  { key: 'clicks', title: 'Clicks', format: numberLabel, ticks: compact.format },
  { key: 'conversions', title: 'Reported conversions', format: conversionLabel, ticks: compact.format },
  { key: 'cpc', title: 'Cost per click', format: metricCurrency, ticks: moneyTicks.format },
  { key: 'ctr', title: 'Click-through rate', format: metricPercent, ticks: percentTicks },
  { key: 'cpa', title: 'Cost per reported conversion', format: metricCurrency, ticks: moneyTicks.format },
] as const satisfies ReadonlyArray<{
  key: keyof BiTotals
  title: string
  format: (value: number | null) => string
  ticks: (value: number) => string
}>

const providerColors: Record<string, string> = {
  google_ads: '#6d28d9',
  meta_ads: '#0369a1',
  ga4: '#b45309',
  tiktok_ads: '#047857',
  linkedin_ads: '#be185d',
  bing_ads: '#0f766e',
}
const otherColors = ['#a16207', '#be123c', '#4338ca', '#475569']

export function CampaignMetricGrid({ report, showPrevious, showChange }: {
  report: BiReport
  showPrevious: boolean
  showChange: boolean
}) {
  const daily = useMemo(() => biChannelTrend(report), [report])
  const platforms = report.channels.map((values, index) => ({
    ...values,
    label: getMarketingChannelLabel(values.channel),
    color: providerColors[values.channel] ?? otherColors[index % otherColors.length],
  }))
  const previous = showPrevious && report.coverage.previousRecords > 0
  const multiple = platforms.length > 1

  return (
    <section aria-label="Campaign metric trends" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Performance over time</h2>
        <ul aria-label="Chart series" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
          {platforms.map(({ channel, label, color }) => (
            <li key={channel} className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-5 rounded" style={{ backgroundColor: color }}/>
              {label}
            </li>
          ))}
          {previous && <li className="flex items-center gap-2">
            <span aria-hidden className="w-5 border-b-2 border-dashed border-slate-500"/>
            Previous period
          </li>}
        </ul>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map(metric => {
          const { key } = metric
          const hasValues = daily.some(day =>
            platforms.some(platform => day.channels[platform.channel]?.[key] != null)
            || previous && day.previous?.[key] != null
          )
          const change = showChange ? report.comparison?.changes[key] : null
          return (
            <article key={key} aria-label={metric.title} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-medium text-slate-700">{metric.title}</h3>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{metric.format(report.totals[key])}</p>
                {change != null && <p className="text-xs tabular-nums text-slate-500">
                  {change > 0 ? '+' : ''}{change.toFixed(1)}% vs previous
                </p>}
              </div>
              {hasValues ? (
                <div className="mt-2">
                  <ResponsiveContainer width="100%" height={126}>
                    <LineChart data={daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3"/>
                      <XAxis dataKey="date" tickFormatter={date => format(parseISO(date), 'MMM d')} minTickGap={18} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}/>
                      <YAxis domain={[0, 'auto']} width={45} tickCount={4} tickFormatter={metric.ticks} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}/>
                      <Tooltip labelFormatter={date => typeof date === 'string' ? format(parseISO(date), 'MMM d, yyyy') : ''} formatter={(value, name) => [metric.format(value == null ? null : Number(value)), name]}/>
                      {platforms.map(platform => (
                        <Line
                          key={platform.channel}
                          name={platform.label}
                          dataKey={(day: (typeof daily)[number]) => day.channels[platform.channel]?.[key] ?? null}
                          stroke={platform.color}
                          strokeWidth={2}
                          connectNulls={false}
                          dot={daily.length <= 45 ? { r: 1.5 } : false}
                          isAnimationActive={false}
                        />
                      ))}
                      {previous && <Line
                        name="Previous period"
                        dataKey={(day: (typeof daily)[number]) => day.previous?.[key] ?? null}
                        stroke="#64748b"
                        strokeDasharray="5 4"
                        strokeWidth={1.5}
                        connectNulls={false}
                        dot={false}
                        isAnimationActive={false}
                      />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="my-2 flex h-[126px] items-center text-sm text-slate-500">No values in this period</p>}
              {multiple && <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs">
                {platforms.map(platform => (
                  <div key={platform.channel} className="flex items-baseline gap-1">
                    <dt style={{ color: platform.color }}>{platform.label}</dt>
                    <dd className="font-medium tabular-nums text-slate-900">{metric.format(platform[key])}</dd>
                  </div>
                ))}
              </dl>}
            </article>
          )
        })}
      </div>
    </section>
  )
}
