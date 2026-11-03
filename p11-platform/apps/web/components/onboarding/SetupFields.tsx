'use client'

import { AMENITY_OPTIONS, INTEGRATION_CONFIG, type CommunityData, type ContactData, type IntegrationData, type IntegrationPlatform } from '@/app/onboarding/types'
import { PROPERTY_TYPE_OPTIONS } from '@/utils/property-types'
import { TextField, IntakeFields, setupButton, setupInput } from './IntakeFields'

export function CommunityFields({ value, onChange }: { value: CommunityData; onChange: (value: Partial<CommunityData>) => void }) {
  return <div className="space-y-6"><TextField label="Community Name" value={value.name} onChange={name => onChange({ name })} required />
    <IntakeFields section="identity" value={value.intake} onChange={intake => onChange({ intake })} />
    <details><summary className="cursor-pointer font-medium">Address, website and property details</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
      {(['street', 'city', 'state', 'zip'] as const).map(key => <TextField key={key} label={{ street: 'Street address', city: 'City', state: 'State / region', zip: 'Postal code' }[key]} value={value.address[key]} onChange={v => onChange({ address: { ...value.address, [key]: v } })} />)}
      <TextField label="Website URL" value={value.websiteUrl} onChange={websiteUrl => onChange({ websiteUrl })} placeholder="https://example.com" />
      <TextField label="Number of units" type="number" value={value.unitCount} onChange={unitCount => onChange({ unitCount })} /><TextField label="Year built" type="number" value={value.yearBuilt} onChange={yearBuilt => onChange({ yearBuilt })} />
      <label className="block text-sm font-medium">Property style<select className={setupInput} value={value.type} onChange={e => onChange({ type: e.target.value as CommunityData['type'] })}><option value="">Not specified</option>{PROPERTY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    </div><div className="mt-4"><TextField label="Additional page addresses, one per line" area value={value.additionalUrls.join('\n')} onChange={v => onChange({ additionalUrls: v.split('\n') })} /></div><p className="mt-2 text-sm">Addresses are references. Capture and review their content in Sources after saving.</p></details>
    <details><summary className="cursor-pointer font-medium">Amenities ({value.amenities.length} selected)</summary><div className="mt-4 grid gap-3 sm:grid-cols-3">{AMENITY_OPTIONS.map(amenity => <label key={amenity} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.amenities.includes(amenity)} onChange={e => onChange({ amenities: e.target.checked ? [...value.amenities, amenity] : value.amenities.filter(a => a !== amenity) })} />{amenity}</label>)}</div></details>
  </div>
}

export function ContactFields({ contacts, onChange }: { contacts: ContactData[]; onChange: (contacts: ContactData[]) => void }) {
  const update = (id: string, patch: Partial<ContactData>) => onChange(contacts.map(c => c.id === id ? { ...c, ...patch } : c))
  const add = (type: ContactData['type']) => onChange([...contacts, { id: crypto.randomUUID(), type, name: '', email: '', phone: '', role: '' }])
  return <div className="space-y-5"><p className="text-sm">The primary contact owns setup internally. These contacts are not automatically used as public website contacts.</p>
    {contacts.map((c, index) => <fieldset key={c.id} className="space-y-4 rounded-xl border border-slate-300 p-4"><legend className="font-semibold">{c.type === 'primary' ? 'Primary internal contact' : `${c.type} contact ${index + 1}`}</legend><div className="grid gap-4 sm:grid-cols-2">
      <TextField label={`${c.type} contact name`} placeholder="Jane Smith" value={c.name} onChange={name => update(c.id, { name })} required />
      <TextField label={`${c.type} contact email`} placeholder="jane@property.com" type="email" value={c.email} onChange={email => update(c.id, { email })} required />
      <TextField label={`${c.type} contact phone`} placeholder="(208) 555-0123" type="tel" value={c.phone} onChange={phone => update(c.id, { phone })} />
      <TextField label={`${c.type} contact role`} placeholder="Property Manager" value={c.role} onChange={role => update(c.id, { role })} />
    </div>{c.type === 'billing' && <><label className="block text-sm">Billing method<select className={setupInput} value={c.billingMethod || ''} onChange={e => update(c.id, { billingMethod: (e.target.value || undefined) as ContactData['billingMethod'] })}><option value="">Decide later</option>{['ops_merchant', 'nexus', 'ach', 'check', 'credit_card', 'other'].map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2">{(['street', 'city', 'state', 'zip'] as const).map(key => <TextField key={key} label={`Billing ${key}`} value={c.billingAddress?.[key] || ''} onChange={v => update(c.id, { billingAddress: { street: '', city: '', state: '', zip: '', ...c.billingAddress, [key]: v } })} />)}</div><label className="flex items-center gap-2"><input type="checkbox" checked={!!c.needsW9} onChange={e => update(c.id, { needsW9: e.target.checked })} />W-9 requested</label></>}
      <details><summary className="cursor-pointer text-sm">Contact instructions</summary><TextField label={`${c.type} contact instructions`} area value={c.specialInstructions || ''} onChange={specialInstructions => update(c.id, { specialInstructions })} /></details>
      {c.type !== 'primary' && <button type="button" className={setupButton} onClick={() => onChange(contacts.filter(x => x.id !== c.id))}>Remove {c.type} contact</button>}
    </fieldset>)}
    <div className="flex flex-wrap gap-2">{(['primary', 'secondary', 'billing', 'emergency'] as const).filter(type => type !== 'primary' || !contacts.some(c => c.type === type)).map(type => <button type="button" key={type} className={setupButton} onClick={() => add(type)}>Add {type} contact</button>)}</div>
  </div>
}

export function ConnectionFields({ values, onChange }: { values: IntegrationData[]; onChange: (values: IntegrationData[]) => void }) {
  return <fieldset className="space-y-3"><legend className="mb-3 text-lg font-semibold">Connection plans</legend><p className="text-sm">Choose services to configure. Plans do not connect accounts or verify access. Keep credentials out of notes.</p>
    {(Object.keys(INTEGRATION_CONFIG) as IntegrationPlatform[]).map(platform => { const c = values.find(i => i.platform === platform), name = INTEGRATION_CONFIG[platform].name; const patch = (data: Partial<IntegrationData>) => onChange(values.map(v => v.platform === platform ? { ...v, ...data, status: 'pending' } : v)); return <div key={platform} className="space-y-3 rounded-lg border border-slate-300 p-4"><label className="flex items-center gap-2"><input type="checkbox" aria-label={`Plan ${name}`} checked={!!c} onChange={e => onChange(e.target.checked ? [...values, { platform, status: 'pending', accountId: '', accountName: '', notes: '' }] : values.filter(v => v.platform !== platform))} />{name}</label>{c && <><div className="grid gap-3 sm:grid-cols-2"><TextField label={`${name} provider or account name`} value={c.accountName} onChange={accountName => patch({ accountName })} /><TextField label={`${name} account or property reference`} value={c.accountId} onChange={accountId => patch({ accountId })} /></div><TextField label={`Setup notes for ${name}`} area value={c.notes} onChange={notes => patch({ notes })} /></>}</div> })}
    <p className="text-sm">Supported provider connections are shown in their setup screens. CallRail and Buildium intelligence adapters are not currently enabled.</p>
  </fieldset>
}
