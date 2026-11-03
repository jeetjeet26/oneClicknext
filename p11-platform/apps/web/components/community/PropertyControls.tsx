'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { propertyWorkflow } from '@/components/onboarding/SetupHandoff'
import { AdAccountConnections } from '@/components/settings/AdAccountConnections'
import { ScheduledReportsList } from '@/components/settings/ScheduledReportsList'

export function PropertyControls({ propertyId }: { propertyId: string }) {
  const query = useSearchParams()
  const [panel, setPanel] = useState<'connections' | 'reports' | null>(() => query.get('setupPanel') === 'advertising' ? 'connections' : null)
  if (!propertyId) return null
  return (
    <section id="community-settings" aria-label="Community settings" className="space-y-4 rounded-xl border border-border bg-card p-5 text-card-foreground">
      <h2 className="text-xl font-semibold">Community settings</h2>
      <p>Set up this community during onboarding and manage it here anytime.</p>
      <div className="flex flex-wrap gap-4">
        <Link className="underline" href={`/dashboard/properties/${propertyId}/edit`}>Edit community setup</Link>
        <Link className="underline" href="/dashboard/settings/crm">CRM setup and delivery</Link>
        <Link className="underline" href="/dashboard/settings/workflows">Follow-up workflows</Link>
        <Link className="underline" href="/dashboard/lumaleasing">Leasing messages and handoffs</Link>
        <Link className="underline" href={propertyWorkflow('/dashboard/community?section=overview&setupPanel=connections#property-connections', propertyId)}>Manage integrations</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg border px-4 py-2" aria-expanded={panel === 'connections'} onClick={() => setPanel(panel === 'connections' ? null : 'connections')}>Advertising connections</button>
        <button className="rounded-lg border px-4 py-2" aria-expanded={panel === 'reports'} onClick={() => setPanel(panel === 'reports' ? null : 'reports')}>Scheduled reports</button>
      </div>
      {panel === 'connections' && <AdAccountConnections />}
      {panel === 'reports' && <ScheduledReportsList />}
    </section>
  )
}
