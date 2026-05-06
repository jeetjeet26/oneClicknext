'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface TrendPoint {
  date: string
  score: number
  visibility: number
}

interface TrendChartProps {
  points?: TrendPoint[]
  height?: number
}

const PADDING_X = 32
const PADDING_Y = 24

function formatDateLabel(value: string) {
  const date = new Date(value)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function TrendChart({ points, height = 180 }: TrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(560)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const safePoints = points ?? []

  useEffect(() => {
    if (!containerRef.current) return
    const element = containerRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width)
        if (width > 0) setChartWidth(width)
      }
    })
    observer.observe(element)
    setChartWidth(element.clientWidth || 560)
    return () => observer.disconnect()
  }, [])

  const chart = useMemo(() => {
    if (safePoints.length === 0) {
      return {
        scoreLine: '',
        visibilityLine: '',
        labels: [] as { x: number; text: string }[],
        minScore: 0,
        maxScore: 100,
        minVisibility: 0,
        maxVisibility: 100
      }
    }

    const usableWidth = chartWidth - PADDING_X * 2
    const usableHeight = height - PADDING_Y * 2

    const scoreValues = safePoints.map((p) => p.score)
    const visibilityValues = safePoints.map((p) => p.visibility)

    const minScore = Math.min(...scoreValues)
    const maxScore = Math.max(...scoreValues)
    const minVisibility = Math.min(...visibilityValues)
    const maxVisibility = Math.max(...visibilityValues)

    const createPolyline = (key: 'score' | 'visibility') => {
      const values = safePoints.map((p) => (key === 'score' ? p.score : p.visibility))
      const minVal = key === 'score' ? minScore : minVisibility
      const maxVal = key === 'score' ? maxScore : maxVisibility
      const range = maxVal - minVal || 1

      return safePoints
        .map((point, index) => {
          const value = key === 'score' ? point.score : point.visibility
          const normalized = (value - minVal) / range
          const x = PADDING_X + (usableWidth / Math.max(safePoints.length - 1, 1)) * index
          const y = height - PADDING_Y - normalized * usableHeight
          return `${x},${y}`
        })
        .join(' ')
    }

    const labels = safePoints.map((point, index) => {
      const x = PADDING_X + (usableWidth / Math.max(safePoints.length - 1, 1)) * index
      return { x, text: formatDateLabel(point.date) }
    })

    return {
      scoreLine: createPolyline('score'),
      visibilityLine: createPolyline('visibility'),
      labels,
      minScore,
      maxScore,
      minVisibility,
      maxVisibility
    }
  }, [safePoints, chartWidth, height])

  if (safePoints.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Trend data will appear after at least two completed audit batches.
        </p>
      </div>
    )
  }

  const handleMouseMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = e.clientX - rect.left
    const usableWidth = chartWidth - PADDING_X * 2
    const pct = Math.max(0, Math.min(1, (x - PADDING_X) / Math.max(1, usableWidth)))
    const idx = Math.round(pct * Math.max(safePoints.length - 1, 0))
    setHoverIndex(safePoints.length ? Math.max(0, Math.min(safePoints.length - 1, idx)) : null)
  }

  const guidelineX = hoverIndex !== null
    ? PADDING_X + ((chartWidth - PADDING_X * 2) / Math.max(safePoints.length - 1, 1)) * hoverIndex
    : null

  return (
    <div ref={containerRef} className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${chartWidth} ${height}`}
        className="overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="score-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Visibility line (blue) */}
        <polyline
          points={chart.visibilityLine}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Score line (indigo) */}
        <polyline
          points={chart.scoreLine}
          fill="none"
          stroke="#6366f1"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Hover guideline */}
        {guidelineX !== null && (
          <line
            x1={guidelineX}
            y1={PADDING_Y - 6}
            x2={guidelineX}
            y2={height - PADDING_Y + 6}
            stroke="#94a3b8"
            strokeDasharray="4 3"
          />
        )}

        {/* X-axis labels */}
        {chart.labels.map((label, i) => (
          <text
            key={i}
            x={label.x}
            y={height - 4}
            textAnchor="middle"
            className="text-[10px] fill-gray-500 dark:fill-gray-400"
          >
            {label.text}
          </text>
        ))}
      </svg>

      {/* Hover tooltip */}
      {hoverIndex !== null && safePoints[hoverIndex] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs shadow-md"
          style={{ left: guidelineX ?? 0, top: 8 }}
        >
          <div className="font-medium text-gray-900 dark:text-white">
            {formatDateLabel(safePoints[hoverIndex].date)}
          </div>
          <div className="mt-0.5 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              {safePoints[hoverIndex].score.toFixed(1)}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              {safePoints[hoverIndex].visibility.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-500" />
          Score ({chart.minScore.toFixed(0)} – {chart.maxScore.toFixed(0)})
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-sky-500" />
          Visibility ({chart.minVisibility.toFixed(0)}% – {chart.maxVisibility.toFixed(0)}%)
        </span>
      </div>
    </div>
  )
}









