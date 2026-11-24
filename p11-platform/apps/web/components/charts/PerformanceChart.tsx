'use client'

import { useMemo, type ReactNode } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'

type DataPoint = {
  date: string
  [key: string]: string | number | null
}

type PerformanceAxis = {
  side: 'left' | 'right'
  color: string
  formatTick: (value: number) => string
  formatValue: (value: number) => string
}

type PerformanceSeries = {
  key: string
  name: string
  axis: PerformanceAxis['side']
  dashed?: boolean
  bar?: boolean
}

type PerformanceChartProps = {
  data: DataPoint[]
  axes: PerformanceAxis[]
  series: PerformanceSeries[]
  title: string
  controls: ReactNode
}

export function PerformanceChart({ data, axes, series, title, controls }: PerformanceChartProps) {
  const formattedData = useMemo(() => data.map(point => ({
    ...point,
    formattedDate: format(parseISO(point.date), 'MMM d'),
  })), [data])
  const hasValues = data.some(point => series.some(item => typeof point[item.key] === 'number'))

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="mb-4 space-y-3">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {controls}
      </div>
      {hasValues ? (
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={formattedData} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="formattedDate"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748b', fontSize: 12 }}
              minTickGap={24}
              dy={8}
            />
            {axes.map(axis => (
              <YAxis
                key={axis.side}
                yAxisId={axis.side}
                orientation={axis.side}
                domain={[0, 'auto']}
                axisLine={false}
                tickLine={false}
                tick={{ fill: axis.color, fontSize: 11 }}
                width={54}
                tickCount={5}
                tickFormatter={axis.formatTick}
              />
            ))}
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
              labelStyle={{ color: '#e2e8f0' }}
              itemStyle={{ color: '#fff' }}
              formatter={(value, name, item) => {
                const line = series.find(entry => entry.key === item.dataKey)
                const axis = axes.find(entry => entry.side === line?.axis)
                return [value == null ? 'Not available' : axis?.formatValue(Number(value)) ?? String(value), name]
              }}
            />
            <Legend wrapperStyle={{ paddingTop: '14px' }} />
            {series.map(item => {
              const color = axes.find(axis => axis.side === item.axis)?.color
              return item.bar ? (
                <Bar key={item.key} yAxisId={item.axis} dataKey={item.key} name={item.name} fill={color} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={30} />
              ) : (
                <Line
                  key={item.key}
                  yAxisId={item.axis}
                  dataKey={item.key}
                  name={item.name}
                  stroke={color}
                  strokeWidth={item.dashed ? 1.5 : 2.5}
                  strokeOpacity={item.dashed ? 0.65 : 1}
                  strokeDasharray={item.dashed ? '5 4' : undefined}
                  connectNulls={false}
                  dot={{ r: 2, strokeWidth: 0, fill: color }}
                  activeDot={{ r: 5 }}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="flex min-h-[350px] items-center justify-center text-sm text-slate-500">
          No values are available for these metrics in the selected dates.
        </p>
      )}
    </div>
  )
}
