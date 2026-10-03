'use client'

import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { format, parseISO } from 'date-fns'

type DataPoint = {
  date: string
  [key: string]: string | number | null
}

type PerformanceChartProps = {
  data: DataPoint[]
  lines: {
    key: string
    name: string
    color: string
  }[]
  title?: string
  loading?: boolean
  height?: number
}

export function PerformanceChart({ 
  data, 
  lines, 
  title,
  loading = false,
  height = 350
}: PerformanceChartProps) {
  const formattedData = useMemo(() => {
    return data.map(point => ({
      ...point,
      formattedDate: format(parseISO(point.date), 'MMM d'),
    }))
  }, [data])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {title && <div className="h-6 bg-slate-200 rounded w-40 mb-6 animate-pulse"></div>}
        <div className="animate-pulse" style={{ height }}>
          <div className="h-full bg-slate-100 rounded-lg"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      {title && (
        <h3 className="text-lg font-semibold text-slate-900 mb-6">{title}</h3>
      )}
      
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {lines.map((line) => (
              <linearGradient key={line.key} id={`gradient-${line.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={line.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={line.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          
          <XAxis 
            dataKey="formattedDate" 
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            dy={10}
          />
          
          <YAxis 
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            dx={-10}
            tickFormatter={(value) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
              if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
              return value.toString()
            }}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: 'none',
              borderRadius: '8px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
            labelStyle={{ color: '#94a3b8', marginBottom: '8px' }}
            itemStyle={{ color: '#fff' }}
            formatter={(value) => {
              const numeric =
                value==null?null:typeof value === 'number' ? value : Number(value)
              return [numeric===null?'Not available':numeric.toLocaleString(), ''] as [string, '']
            }}
            labelFormatter={(label) => label}
          />
          
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="circle"
            iconSize={8}
          />
          
          {lines.map((line) => (
            <Area
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              fill={`url(#gradient-${line.key})`}
              activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}















