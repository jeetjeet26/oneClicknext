'use client'

import { useState, useRef } from 'react'
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { 
  format, 
  subDays, 
  startOfMonth, 
  endOfMonth, 
  subMonths, 
  startOfQuarter, 
  endOfQuarter, 
  subQuarters,
  startOfYear,
  addMonths,
  isSameDay,
  isBefore,
  isAfter,
  startOfDay,
  endOfDay,
  getDaysInMonth,
  getDay,
  isWithinInterval
} from 'date-fns'

type DateRange = {
  start: Date
  end: Date
  label: string
}

type DateRangePickerProps = {
  value: DateRange
  onChange: (range: DateRange) => void
}

const PRESETS: DateRange[] = [
  {
    label: 'Last 7 days',
    start: subDays(new Date(), 6),
    end: new Date(),
  },
  {
    label: 'Last 14 days',
    start: subDays(new Date(), 13),
    end: new Date(),
  },
  {
    label: 'Last 30 days',
    start: subDays(new Date(), 29),
    end: new Date(),
  },
  {
    label: 'Last 90 days',
    start: subDays(new Date(), 89),
    end: new Date(),
  },
  {
    label: 'This month',
    start: startOfMonth(new Date()),
    end: new Date(),
  },
  {
    label: 'Last month',
    start: startOfMonth(subMonths(new Date(), 1)),
    end: endOfMonth(subMonths(new Date(), 1)),
  },
  {
    label: 'This quarter',
    start: startOfQuarter(new Date()),
    end: new Date(),
  },
  {
    label: 'Last quarter',
    start: startOfQuarter(subQuarters(new Date(), 1)),
    end: endOfQuarter(subQuarters(new Date(), 1)),
  },
  {
    label: 'Year to date',
    start: startOfYear(new Date()),
    end: new Date(),
  },
]

function CalendarMonth({ 
  month, 
  selectedStart, 
  selectedEnd, 
  hoverDate,
  onDateClick,
  onDateHover 
}: { 
  month: Date
  selectedStart: Date | null
  selectedEnd: Date | null
  hoverDate: Date | null
  onDateClick: (date: Date) => void
  onDateHover: (date: Date | null) => void
}) {
  const daysInMonth = getDaysInMonth(month)
  const firstDayOfWeek = getDay(startOfMonth(month))
  const days: (Date | null)[] = []
  
  // Add empty slots for days before the first day of month
  for (let i = 0; i < firstDayOfWeek; i++) {
    days.push(null)
  }
  
  // Add all days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(month.getFullYear(), month.getMonth(), i))
  }
  
  const isSelected = (date: Date) => {
    if (selectedStart && isSameDay(date, selectedStart)) return true
    if (selectedEnd && isSameDay(date, selectedEnd)) return true
    return false
  }
  
  const isInRange = (date: Date) => {
    if (!selectedStart) return false
    
    const end = selectedEnd || hoverDate
    if (!end) return false
    
    const rangeStart = isBefore(selectedStart, end) ? selectedStart : end
    const rangeEnd = isAfter(selectedStart, end) ? selectedStart : end
    
    return isWithinInterval(date, { start: rangeStart, end: rangeEnd })
  }
  
  const isRangeStart = (date: Date) => {
    if (!selectedStart) return false
    const end = selectedEnd || hoverDate
    if (!end) return isSameDay(date, selectedStart)
    
    const rangeStart = isBefore(selectedStart, end) ? selectedStart : end
    return isSameDay(date, rangeStart)
  }
  
  const isRangeEnd = (date: Date) => {
    if (!selectedStart) return false
    const end = selectedEnd || hoverDate
    if (!end) return false
    
    const rangeEnd = isAfter(selectedStart, end) ? selectedStart : end
    return isSameDay(date, rangeEnd)
  }
  
  const isToday = (date: Date) => isSameDay(date, new Date())
  const isFuture = (date: Date) => isAfter(startOfDay(date), endOfDay(new Date()))
  
  return (
    <div>
      <div className="text-center font-medium text-slate-700 mb-2">
        {format(month, 'MMMM yyyy')}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
          <div key={day} className="text-xs font-medium text-slate-400 py-1">
            {day}
          </div>
        ))}
        {days.map((date, i) => (
          <div key={i} className="aspect-square flex items-center justify-center">
            {date ? (
              <button
                type="button"
                disabled={isFuture(date)}
                onClick={() => onDateClick(date)}
                onMouseEnter={() => onDateHover(date)}
                onMouseLeave={() => onDateHover(null)}
                className={`w-8 h-8 text-sm rounded-lg transition-all flex items-center justify-center
                  ${isFuture(date) ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-indigo-100'}
                  ${isSelected(date) ? 'bg-indigo-600 text-white font-medium hover:bg-indigo-600' : ''}
                  ${isInRange(date) && !isSelected(date) ? 'bg-indigo-100 text-indigo-700' : ''}
                  ${isRangeStart(date) ? 'rounded-r-none' : ''}
                  ${isRangeEnd(date) ? 'rounded-l-none' : ''}
                  ${isInRange(date) && !isRangeStart(date) && !isRangeEnd(date) ? 'rounded-none' : ''}
                  ${isToday(date) && !isSelected(date) ? 'ring-1 ring-indigo-400' : ''}
                `}
              >
                {date.getDate()}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(subMonths(new Date(), 1))
  const [selectedStart, setSelectedStart] = useState<Date | null>(null)
  const [selectedEnd, setSelectedEnd] = useState<Date | null>(null)
  const [hoverDate, setHoverDate] = useState<Date | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  function closeCustom(){setShowCustom(false);setSelectedStart(null);setSelectedEnd(null);setHoverDate(null)}

  const handleDateClick = (date: Date) => {
    if (!selectedStart || (selectedStart && selectedEnd)) {
      // First click or reset
      setSelectedStart(date)
      setSelectedEnd(null)
    } else {
      // Second click - complete the range
      if (isBefore(date, selectedStart)) {
        setSelectedEnd(selectedStart)
        setSelectedStart(date)
      } else {
        setSelectedEnd(date)
      }
    }
  }
  
  const handleApplyCustom = () => {
    if (selectedStart && selectedEnd) {
      onChange({
        label: 'Custom range',
        start: startOfDay(selectedStart),
        end: endOfDay(selectedEnd),
      })
      closeCustom()
      setIsOpen(false)
    }
  }
  
  const handleClearCustom = () => {
    setSelectedStart(null)
    setSelectedEnd(null)
    setHoverDate(null)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {if(isOpen)closeCustom();setIsOpen(!isOpen)}}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700"
      >
        <Calendar size={16} className="text-slate-400" />
        <span>{value.label}</span>
        <span className="text-slate-400 hidden sm:inline">
          ({format(value.start, 'MMM d')} - {format(value.end, 'MMM d')})
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => {
              setIsOpen(false)
              closeCustom()
            }}
          />
          <div className={`absolute right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200 z-20 animate-in fade-in slide-in-from-top-1 duration-150 ${showCustom ? 'w-auto' : 'w-64'}`}>
            {!showCustom ? (
              // Presets View
              <div className="py-1">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Quick Select</p>
                </div>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      onChange(preset)
                      setIsOpen(false)
                    }}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors flex items-center justify-between ${
                      value.label === preset.label 
                        ? 'text-indigo-600 bg-indigo-50 font-medium' 
                        : 'text-slate-700'
                    }`}
                  >
                    <span>{preset.label}</span>
                    <span className="text-xs text-slate-400">
                      {format(preset.start, 'M/d')} - {format(preset.end, 'M/d')}
                    </span>
                  </button>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    onClick={() => setShowCustom(true)}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors flex items-center justify-between ${
                      value.label === 'Custom range' 
                        ? 'text-indigo-600 bg-indigo-50 font-medium' 
                        : 'text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Calendar size={14} />
                      Custom range...
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              // Custom Date Range View
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-slate-900">Select Date Range</h3>
                  <button
                    onClick={() => closeCustom()}
                    className="p-1 hover:bg-slate-100 rounded transition-colors"
                  >
                    <X size={16} className="text-slate-400" />
                  </button>
                </div>
                
                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <ChevronLeft size={18} className="text-slate-600" />
                  </button>
                  <div className="flex gap-8">
                    <span className="text-sm font-medium text-slate-700">
                      {format(currentMonth, 'MMMM yyyy')}
                    </span>
                    <span className="text-sm font-medium text-slate-700">
                      {format(addMonths(currentMonth, 1), 'MMMM yyyy')}
                    </span>
                  </div>
                  <button
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <ChevronRight size={18} className="text-slate-600" />
                  </button>
                </div>
                
                {/* Two-month calendar view */}
                <div className="flex gap-6">
                  <CalendarMonth
                    month={currentMonth}
                    selectedStart={selectedStart}
                    selectedEnd={selectedEnd}
                    hoverDate={hoverDate}
                    onDateClick={handleDateClick}
                    onDateHover={setHoverDate}
                  />
                  <CalendarMonth
                    month={addMonths(currentMonth, 1)}
                    selectedStart={selectedStart}
                    selectedEnd={selectedEnd}
                    hoverDate={hoverDate}
                    onDateClick={handleDateClick}
                    onDateHover={setHoverDate}
                  />
                </div>
                
                {/* Selected range display */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      {selectedStart && (
                        <span className="text-slate-600">
                          {format(selectedStart, 'MMM d, yyyy')}
                          {selectedEnd && (
                            <span> → {format(selectedEnd, 'MMM d, yyyy')}</span>
                          )}
                        </span>
                      )}
                      {!selectedStart && (
                        <span className="text-slate-400">Select start date</span>
                      )}
                    </div>
                    {selectedStart && (
                      <button
                        onClick={handleClearCustom}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Action buttons */}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => closeCustom()}
                    className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApplyCustom}
                    disabled={!selectedStart || !selectedEnd}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply Range
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export { PRESETS as DATE_PRESETS }
export type { DateRange }

