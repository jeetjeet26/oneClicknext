'use client'
import { useEffect, useRef, type ReactNode } from 'react'

const labels: Record<string, string> = { organization: 'Organization', community: 'Property', contacts: 'Contacts', integrations: 'Products', knowledge: 'Sources', review: 'Review' }
export function WizardLayout({ step, account = false, children }: { step: string; account?: boolean; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { const heading = content.current?.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus() } }, [step])
  const steps = Object.keys(labels).filter(key => account || key !== 'organization')
  return <div className="setup-shell min-h-screen bg-slate-50 px-4 py-8 text-slate-900 dark:bg-slate-950 dark:text-slate-100"><div className="mx-auto max-w-4xl space-y-6">
    {step !== 'complete' && <nav aria-label="Setup progress"><ol className="flex flex-wrap gap-2 text-sm">{steps.map((key, index) => <li key={key} aria-current={key === step ? 'step' : undefined} className={`rounded-lg border px-3 py-2 ${key === step ? 'border-indigo-600 bg-indigo-50 font-semibold text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100' : 'border-slate-300'}`}>{index + 1}. {labels[key]}</li>)}</ol></nav>}
    <div ref={content} className="space-y-4">{children}</div><p className="text-center text-sm">P11 · Property operations and marketing</p>
  </div></div>
}
