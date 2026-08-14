import * as React from "react"

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  value?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
}

export function Select({ value, onValueChange, children, className = '', ...props }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      className={`w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}

export function SelectTrigger({ id, className = '' }: { id?: string; className?: string }) {
  void id
  void className
  // This is just a placeholder for API compatibility - not actually rendered
  return null
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  void placeholder
  // This is just a placeholder for API compatibility - not actually rendered
  return null
}

export function SelectContent({ children }: { children?: React.ReactNode }) {
  // This passes through the children (option elements)
  return <>{children}</>
}

export function SelectItem({ value, children, ...props }: React.OptionHTMLAttributes<HTMLOptionElement>) {
  return (
    <option value={value} {...props}>
      {children}
    </option>
  )
}


















