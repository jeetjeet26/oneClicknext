'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AccountSettingsWorkbench } from '@/components/settings/AccountSettingsWorkbench'

export default function SettingsPage() {
  const [panel, setPanel] = useState<'organization' | 'personal'>('organization')
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <p className="text-muted-foreground">Manage your organization and personal account. Community settings are managed in <Link className="underline" href="/dashboard/community?section=overview">Property Overview</Link>.</p>
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {([['organization', 'Organization'], ['personal', 'Your account']] as const).map(([id, label]) => (
          <button key={id} className={`rounded-lg border border-border px-4 py-2 text-sm ${panel === id ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'}`} aria-current={panel === id ? 'page' : undefined} onClick={() => setPanel(id)}>{label}</button>
        ))}
      </nav>
      <AccountSettingsWorkbench key={panel} section={panel} />
    </div>
  )
}
