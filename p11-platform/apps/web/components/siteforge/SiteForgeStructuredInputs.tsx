'use client'

import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const inputClassName =
  'h-9 w-full rounded-md border bg-transparent px-3 text-sm'

export function StructuredInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'url'
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      <input
        className={inputClassName}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  )
}

export function RepeatableSection({
  label,
  description,
  addLabel,
  items,
  onAdd,
  onRemove,
  renderItem,
}: {
  label: string
  description?: string
  addLabel: string
  items: readonly unknown[]
  onAdd: () => void
  onRemove: (index: number) => void
  renderItem: (index: number) => ReactNode
}) {
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      {description ? <p className="text-xs text-gray-500">{description}</p> : null}
      {items.length ? (
        <div className="space-y-3">
          {items.map((_, index) => (
            <div key={index} className="relative rounded-md border bg-gray-50/50 p-3 pr-11 dark:bg-gray-900/50">
              {renderItem(index)}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-8 w-8"
                aria-label={`Remove ${label.toLowerCase()} item ${index + 1}`}
                onClick={() => onRemove(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No {label.toLowerCase()} added.</p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        {addLabel}
      </Button>
    </fieldset>
  )
}

export function StringListInput({
  label,
  values,
  onChange,
  addLabel,
  placeholder,
  required,
}: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  addLabel: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <RepeatableSection
      label={label}
      addLabel={addLabel}
      items={values}
      onAdd={() => onChange([...values, ''])}
      onRemove={index => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
      renderItem={index => (
        <StructuredInput
          label={`${label} ${index + 1}`}
          value={values[index] || ''}
          onChange={value =>
            onChange(values.map((item, itemIndex) => (itemIndex === index ? value : item)))
          }
          placeholder={placeholder}
          required={required}
        />
      )}
    />
  )
}

export function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  function addDraft() {
    const value = draft.trim()
    if (!value || values.includes(value)) return
    onChange([...values, value])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {values.length ? (
        <div className="flex flex-wrap gap-2" aria-label={label}>
          {values.map(value => (
            <span key={value} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
              {value}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Remove ${value} from ${label.toLowerCase()}`}
                onClick={() => onChange(values.filter(item => item !== value))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <input
          className={inputClassName}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addDraft()
            }
          }}
          placeholder={placeholder}
          aria-label={`New ${label.toLowerCase()}`}
        />
        <Button type="button" variant="outline" onClick={addDraft} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}
