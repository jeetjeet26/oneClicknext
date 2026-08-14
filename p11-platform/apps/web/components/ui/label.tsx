import * as React from "react"

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={`text-sm font-medium text-foreground ${className}`}
        {...props}
      />
    )
  }
)

Label.displayName = "Label"


















