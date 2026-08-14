import * as React from "react"

export interface TabsProps {
  value?: string
  onValueChange?: (value: string) => void
  className?: string
  children?: React.ReactNode
}

export function Tabs({ value, onValueChange, className = '', children }: TabsProps) {
  const id = React.useId()
  return (
    <div className={className}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          // Pass onValueChange only to TabsList (for triggers), currentValue to both
          if (child.type === TabsList) {
            return React.cloneElement(child as React.ReactElement<TabsListProps>, {
              currentValue: value,
              onValueChange,
              tabsId: id,
            })
          }
          if (child.type === TabsContent) {
            return React.cloneElement(child as React.ReactElement<TabsContentProps>, {
              currentValue: value,
              tabsId: id,
            })
          }
        }
        return child
      })}
    </div>
  )
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  currentValue?: string
  onValueChange?: (value: string) => void
  tabsId?: string
}

export function TabsList({ className = '', children, currentValue, onValueChange, tabsId, ...props }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={`inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground ${className}`}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')
        )
        const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement)
        if (currentIndex < 0 || tabs.length === 0) return
        event.preventDefault()
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                tabs.length
        tabs[nextIndex].focus()
        tabs[nextIndex].click()
      }}
      {...props}
    >
      {React.Children.map(children, child => {
        if (React.isValidElement(child) && child.type === TabsTrigger) {
          return React.cloneElement(child as React.ReactElement<TabsTriggerProps>, {
            currentValue,
            onValueChange,
            tabsId,
          })
        }
        return child
      })}
    </div>
  )
}

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
  currentValue?: string
  onValueChange?: (value: string) => void
  tabsId?: string
}

export function TabsTrigger({ 
  value, 
  currentValue, 
  onValueChange, 
  tabsId,
  className = '', 
  children, 
  ...props 
}: TabsTriggerProps) {
  const isActive = value === currentValue

  return (
    <button
      type="button"
      id={tabsId ? `${tabsId}-tab-${value}` : undefined}
      role="tab"
      aria-selected={isActive}
      aria-controls={tabsId ? `${tabsId}-panel-${value}` : undefined}
      tabIndex={isActive ? 0 : -1}
      onClick={() => onValueChange?.(value)}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  currentValue?: string
  onValueChange?: (value: string) => void // Accept but ignore (for cloneElement compatibility)
  tabsId?: string
}

export function TabsContent({ 
  value, 
  currentValue, 
  onValueChange: _onValueChange, // Destructure to prevent spreading to div
  tabsId,
  className = '', 
  children, 
  ...props 
}: TabsContentProps) {
  void _onValueChange
  if (value !== currentValue) return null

  return (
    <div
      id={tabsId ? `${tabsId}-panel-${value}` : undefined}
      role="tabpanel"
      aria-labelledby={tabsId ? `${tabsId}-tab-${value}` : undefined}
      tabIndex={0}
      className={`mt-4 focus:outline-none ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}


















