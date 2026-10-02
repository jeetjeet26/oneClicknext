'use client'
import {Instagram,Facebook,Linkedin,Twitter} from '@/components/ui/BrandIcons'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar, Clock, FileText } from 'lucide-react'

interface ScheduledContent {
  id: string
  title: string
  platform: string
  scheduled_for: string
  status: string
  caption: string
  media_urls: string[]
}

interface ContentCalendarProps {
  propertyId: string
}

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  twitter: Twitter,
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'bg-pink-500',
  facebook: 'bg-blue-600',
  linkedin: 'bg-blue-700',
  twitter: 'bg-slate-700',
}

export function ContentCalendar({ propertyId }: ContentCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [scheduledContent, setScheduledContent] = useState<ScheduledContent[]>([])
  const [loading, setLoading] = useState(true)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPadding = firstDay.getDay()
  const daysInMonth = lastDay.getDate()

  useEffect(() => {
    async function fetchScheduled() {
      setLoading(true)
      try {
        const res = await fetch(`/api/forgestudio/drafts?propertyId=${propertyId}&status=scheduled`)
        const data = await res.json()
        setScheduledContent(data.drafts || [])
      } catch (err) {
        console.error('Error fetching scheduled content:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchScheduled()
  }, [propertyId])

  const getContentForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return scheduledContent.filter(c => c.scheduled_for?.startsWith(dateStr))
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))
  const goToToday = () => setCurrentDate(new Date())

  const isToday = (day: number) => {
    const today = new Date()
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          <button
            onClick={goToToday}
            className="text-sm text-violet-600 hover:text-violet-700"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5 text-slate-400" />
          </button>
          <button
            onClick={nextMonth}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7">
        {/* Weekday Headers */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="p-3 text-center text-sm font-medium text-slate-500 border-b border-slate-200 dark:border-slate-700">
            {day}
          </div>
        ))}

        {/* Empty cells for padding */}
        {Array.from({ length: startPadding }).map((_, i) => (
          <div key={`empty-${i}`} className="p-2 min-h-[100px] bg-slate-50 dark:bg-slate-900/50 border-b border-r border-slate-200 dark:border-slate-700" />
        ))}

        {/* Days */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const content = getContentForDay(day)
          
          return (
            <div
              key={day}
              className={`p-2 min-h-[100px] border-b border-r border-slate-200 dark:border-slate-700 ${
                isToday(day) ? 'bg-violet-50 dark:bg-violet-500/10' : ''
              }`}
            >
              <div className={`text-sm font-medium mb-1 ${
                isToday(day) ? 'text-violet-600 dark:text-violet-400' : 'text-slate-700 dark:text-slate-300'
              }`}>
                {day}
              </div>
              
              <div className="space-y-1">
                {content.slice(0, 3).map((item) => {
                  const Icon = PLATFORM_ICONS[item.platform] || FileText
                  const color = PLATFORM_COLORS[item.platform] || 'bg-slate-500'
                  
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs text-white ${color} truncate cursor-pointer hover:opacity-90`}
                      title={item.caption}
                    >
                      <Icon className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">
                        {new Date(item.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )
                })}
                {content.length > 3 && (
                  <div className="text-xs text-slate-500 px-2">
                    +{content.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

