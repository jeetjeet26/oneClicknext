'use client'

import { useMemo, useState } from 'react'

interface DumbbellPoint {
  id: string
  label: string
  primary: number
  secondary: number
}

interface DumbbellChartProps {
  data: DumbbellPoint[]
  height?: number
  showValues?: boolean
  primaryLabel?: string
  secondaryLabel?: string
}

export function DumbbellChart({
  data,
  height = 300,
  showValues = true,
  primaryLabel = 'Primary',
  secondaryLabel = 'Secondary',
}: DumbbellChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'delta' | 'primary' | 'secondary' | 'label'>('delta')

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      switch (sortBy) {
        case 'primary':
          return b.primary - a.primary
        case 'secondary':
          return b.secondary - a.secondary
        case 'delta':
          return Math.abs(b.secondary - b.primary) - Math.abs(a.secondary - a.primary)
        case 'label':
          return a.label.localeCompare(b.label)
        default:
          return 0
      }
    })
  }, [data, sortBy])

  const svgWidth = 700
  const labelWidth = 250
  const chartAreaStart = labelWidth + 20
  const chartAreaWidth = svgWidth - chartAreaStart - 60
  const paddingTop = 40
  const paddingBottom = 40
  const minRowHeight = 36
  const calculatedHeight = Math.max(height, sortedData.length * minRowHeight + paddingTop + paddingBottom)
  const rowHeight = (calculatedHeight - paddingTop - paddingBottom) / Math.max(sortedData.length, 1)

  const chart = useMemo(() => {
    if (sortedData.length === 0) {
      return { min: 0, max: 100, points: [] }
    }

    const allValues = [...sortedData.map((d) => d.primary), ...sortedData.map((d) => d.secondary)]
    const min = Math.min(...allValues, 0)
    const max = Math.max(...allValues, 100)
    const range = max - min || 1

    const points = sortedData.map((point, index) => {
      const primaryX = chartAreaStart + ((point.primary - min) / range) * chartAreaWidth
      const secondaryX = chartAreaStart + ((point.secondary - min) / range) * chartAreaWidth
      const y = paddingTop + index * rowHeight + rowHeight / 2
      const delta = point.secondary - point.primary

      return { ...point, primaryX, secondaryX, y, delta }
    })

    return { min, max, points }
  }, [sortedData, chartAreaStart, chartAreaWidth, rowHeight])

  const truncateLabel = (text: string, maxLength = 30): string => {
    if (text.length <= maxLength) return text
    const truncated = text.substring(0, maxLength)
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...'
    }
    return truncated + '...'
  }

  if (sortedData.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-500">No comparison data available</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
            {primaryLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
            {secondaryLabel}
          </span>
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs"
        >
          <option value="delta">Sort by difference</option>
          <option value="primary">Sort by {primaryLabel}</option>
          <option value="secondary">Sort by {secondaryLabel}</option>
          <option value="label">Sort by name</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={svgWidth}
          height={calculatedHeight}
          viewBox={`0 0 ${svgWidth} ${calculatedHeight}`}
          className="overflow-visible"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const x = chartAreaStart + pct * chartAreaWidth
            return (
              <line
                key={pct}
                x1={x}
                y1={paddingTop - 10}
                x2={x}
                y2={calculatedHeight - paddingBottom}
                stroke="currentColor"
                className="text-gray-100 dark:text-gray-800"
                strokeWidth="1"
              />
            )
          })}

          {/* Data points */}
          {chart.points.map((point) => {
            const isHovered = hoveredId === point.id
            const lineColor = point.delta > 0 ? '#a855f7' : point.delta < 0 ? '#22c55e' : '#64748b'

            return (
              <g
                key={point.id}
                onMouseEnter={() => setHoveredId(point.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer"
              >
                {/* Connecting line */}
                <line
                  x1={point.primaryX}
                  y1={point.y}
                  x2={point.secondaryX}
                  y2={point.y}
                  stroke={lineColor}
                  strokeWidth={isHovered ? 3 : 2}
                  opacity={isHovered ? 0.6 : 0.4}
                />

                {/* Primary dot */}
                <circle
                  cx={point.primaryX}
                  cy={point.y}
                  r={isHovered ? 8 : 6}
                  fill="#22c55e"
                  stroke="white"
                  strokeWidth="2"
                />

                {/* Secondary dot */}
                <circle
                  cx={point.secondaryX}
                  cy={point.y}
                  r={isHovered ? 8 : 6}
                  fill="#a855f7"
                  stroke="white"
                  strokeWidth="2"
                />

                {/* Label */}
                <text
                  x={10}
                  y={point.y + 4}
                  className={`text-[11px] fill-gray-700 dark:fill-gray-300 ${isHovered ? 'font-semibold' : ''}`}
                >
                  {truncateLabel(point.label)}
                </text>

                {/* Values */}
                {showValues && (
                  <>
                    <text
                      x={point.primaryX}
                      y={point.y - 12}
                      textAnchor="middle"
                      className="text-[10px] fill-gray-600 dark:fill-gray-400"
                    >
                      {point.primary.toFixed(1)}
                    </text>
                    <text
                      x={point.secondaryX}
                      y={point.y - 12}
                      textAnchor="middle"
                      className="text-[10px] fill-gray-600 dark:fill-gray-400 font-medium"
                    >
                      {point.secondary.toFixed(1)}
                    </text>
                  </>
                )}

                {/* Delta indicator on hover */}
                {isHovered && (
                  <text
                    x={(point.primaryX + point.secondaryX) / 2}
                    y={point.y + 18}
                    textAnchor="middle"
                    className="text-[9px] fill-gray-500 font-medium"
                  >
                    Δ {point.delta > 0 ? '+' : ''}{point.delta.toFixed(1)}
                  </text>
                )}
              </g>
            )
          })}

          {/* Scale labels */}
          <text
            x={chartAreaStart}
            y={calculatedHeight - 15}
            textAnchor="middle"
            className="text-[10px] fill-gray-500"
          >
            {chart.min.toFixed(0)}
          </text>
          <text
            x={chartAreaStart + chartAreaWidth}
            y={calculatedHeight - 15}
            textAnchor="middle"
            className="text-[10px] fill-gray-500"
          >
            {chart.max.toFixed(0)}
          </text>
        </svg>
      </div>
    </div>
  )
}









