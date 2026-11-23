'use client'

import { useEffect, useState } from 'react'

type Platform = 'google_ads' | 'meta_ads'
const platforms = [
  { id: 'google_ads', label: 'Google Ads', endpoint: '/api/integrations/google-ads/accounts' },
  { id: 'meta_ads', label: 'Meta Ads', endpoint: '/api/integrations/meta-ads/accounts' },
] as const

type AdConnection = {
  id: string
  property_id: string
  platform: string
  account_id: string
  account_name: string | null
  is_active: boolean | null
  last_imported_at: string | null
}
type ConnectionList = { connections: AdConnection[]; canManage: boolean; canLink: boolean }
type Account = { id: string; name: string }
type GoogleAccount = { customer_id: string; descriptive_name: string; linked: boolean }
type MetaAccount = Account & { linked: boolean }
type DiscoveryResponse = {
  accounts?: (GoogleAccount | MetaAccount)[]
  mcc_id?: string
  configured?: boolean
  error?: string
}
type Candidates = { accounts: Account[]; managerId?: string }

async function loadConnections(propertyId: string, signal: AbortSignal): Promise<ConnectionList> {
  const query = new URLSearchParams({ property_id: propertyId })
  const response = await fetch(`/api/integrations/ad-connections?${query}`, { signal, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not load advertising connections.')
  if (!Array.isArray(data.connections) || data.connections.some((row: AdConnection | null) => row?.property_id !== propertyId)) {
    throw new Error('Could not confirm advertising connections for this community.')
  }
  return data
}

async function discoverAccounts(endpoint: string, signal: AbortSignal): Promise<Candidates> {
  const response = await fetch(endpoint, { signal, cache: 'no-store' })
  const data: DiscoveryResponse = await response.json()
  if (!response.ok || data.configured !== true || !Array.isArray(data.accounts)) {
    throw new Error(data.error || 'Could not load available ad accounts.')
  }
  return {
    accounts: data.accounts.filter(account => !account.linked).map(account => 'customer_id' in account
      ? { id: account.customer_id, name: account.descriptive_name }
      : { id: account.id, name: account.name }),
    managerId: data.mcc_id,
  }
}

const outlineButton = 'rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'

function AccountPicker({ endpoint, label, propertyName, onClose, onLink }: {
  endpoint: string
  label: string
  propertyName: string
  onClose: () => void
  onLink: (account: Account, managerId?: string) => Promise<void>
}) {
  const [load, setLoad] = useState<{ candidates?: Candidates; error?: string }>({})
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void discoverAccounts(endpoint, controller.signal).then(candidates => {
      if (!controller.signal.aborted) setLoad({ candidates })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoad({ error: error instanceof Error ? error.message : 'Could not load available ad accounts.' })
    })
    return () => controller.abort()
  }, [endpoint, attempt])

  async function saveLink() {
    if (!account || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onLink(account, load.candidates?.managerId)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not link the ad account.')
    } finally {
      setSaving(false)
    }
  }

  const filter = search.trim().toLowerCase()
  const accounts = load.candidates?.accounts.filter(candidate =>
    candidate.name.toLowerCase().includes(filter) || candidate.id.includes(filter),
  ) ?? []

  return <div className="space-y-3 rounded-lg border bg-muted/30 p-4" aria-label={`${label} account picker`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium">Link {label} to {propertyName}</h4>
      <button type="button" className={outlineButton} disabled={saving} onClick={onClose}>Cancel</button>
    </div>
    <p className="text-sm text-muted-foreground">Choose an ad account dedicated to {propertyName}. Imports include the entire ad account.</p>
    {load.error ? <>
      <p role="alert" className="text-sm text-red-700">{load.error}</p>
      <button type="button" className={outlineButton} onClick={() => { setLoad({}); setAttempt(value => value + 1) }}>Retry loading accounts</button>
    </> : !load.candidates ? <p role="status" className="text-sm">Loading available accounts…</p> : <>
      <label className="block text-sm">
        Search available accounts
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} disabled={saving} className="mt-1 block w-full rounded-lg border bg-background px-3 py-2" />
      </label>
      {accounts.length ? <ul className="max-h-64 space-y-2 overflow-y-auto" aria-label="Available ad accounts">
        {accounts.map(candidate => <li key={candidate.id}>
          <button type="button" aria-pressed={account?.id === candidate.id} disabled={saving} onClick={() => setAccount(candidate)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted ${account?.id === candidate.id ? 'border-indigo-500 bg-indigo-500/10' : 'bg-background'}`}>
            <span className="font-medium">{candidate.name}</span> <span className="text-muted-foreground">{candidate.id}</span>
          </button>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">{filter ? 'No accounts match your search.' : 'No unlinked accounts are available.'}</p>}
      {account && <p className="text-sm">Selected account: <strong>{account.name}</strong></p>}
      {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
      <button type="button" className={outlineButton} disabled={!account || saving} onClick={() => void saveLink()}>{saving ? 'Linking…' : 'Confirm link'}</button>
    </>}
  </div>
}

export function AdAccountConnections({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const [load, setLoad] = useState<{ list?: ConnectionList; error?: string }>({})
  const [revision, setRevision] = useState(0)
  const [picker, setPicker] = useState<Platform | null>(null)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void loadConnections(propertyId, controller.signal).then(list => {
      if (!controller.signal.aborted) setLoad({ list })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoad({ error: error instanceof Error ? error.message : 'Could not load advertising connections.' })
    })
    return () => controller.abort()
  }, [propertyId, revision])

  function reload() {
    setPicker(null)
    setActionError(null)
    setLoad({})
    setRevision(value => value + 1)
  }

  async function link(platform: Platform, account: Account, managerId?: string) {
    const response = await fetch('/api/integrations/ad-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId, platform, account_id: account.id, account_name: account.name,
        manager_account_id: platform === 'google_ads' ? managerId : undefined,
      }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Could not link the ad account.')
    }
    reload()
  }

  async function unlink(connection: AdConnection) {
    if (!window.confirm(`Unlink ${connection.account_name || connection.account_id} from ${propertyName}?`)) return
    setUnlinking(connection.id)
    setActionError(null)
    try {
      const query = new URLSearchParams({ id: connection.id, property_id: propertyId })
      const response = await fetch(`/api/integrations/ad-connections?${query}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Could not unlink the ad account.')
      }
      reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not unlink the ad account.')
    } finally {
      setUnlinking(null)
    }
  }

  const { list, error } = load
  return <section aria-label={`Advertising connections for ${propertyName}`} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Advertising connections for {propertyName}</h3>
      <button type="button" onClick={reload} disabled={!list && !error || picker !== null || unlinking !== null} className={outlineButton}>Refresh connections</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
    {!list && !error && <p role="status" className="text-sm">Loading saved connections…</p>}
    {list && platforms.map(platform => {
      const connections = list.connections.filter(connection => connection.platform === platform.id)
      return <div key={platform.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium">{platform.label}</h4>
          {list.canLink && !connections.length && picker !== platform.id && <button type="button" className={outlineButton} disabled={picker !== null || unlinking !== null} onClick={() => setPicker(platform.id)}>Link {platform.label} account</button>}
        </div>
        {connections.length ? <ul className="space-y-2">
          {connections.map(connection => <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm">
            <div>
              <p className="font-medium">{connection.account_name || `Account ${connection.account_id}`}</p>
              <p className="text-muted-foreground">{connection.account_id} · {connection.is_active ? 'Active' : 'Inactive'}{connection.last_imported_at && ` · Last imported ${new Date(connection.last_imported_at).toLocaleDateString()}`}</p>
            </div>
            {list.canManage && <button type="button" className={outlineButton} disabled={unlinking !== null || picker !== null} onClick={() => void unlink(connection)}>{unlinking === connection.id ? 'Unlinking…' : 'Unlink'}</button>}
          </li>)}
        </ul> : picker !== platform.id && <p className="text-sm text-muted-foreground">No {platform.label} account is linked to this community.</p>}
        {picker === platform.id && list.canLink && <AccountPicker
          endpoint={platform.endpoint} label={platform.label} propertyName={propertyName}
          onClose={() => setPicker(null)} onLink={(account, managerId) => link(platform.id, account, managerId)}
        />}
      </div>
    })}
  </section>
}
