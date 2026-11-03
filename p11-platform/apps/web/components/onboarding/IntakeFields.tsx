'use client'

import { useId } from 'react'
import { emptyIntake, newSourcePlan, SETUP_PRODUCTS, SOURCE_KINDS, type SetupIntake } from '@/utils/property-setup/intake'

export const setupInput = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
export const setupButton = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-600'
export const setupPrimary = `${setupButton} bg-indigo-600 text-white border-indigo-600`
export const setupPanel = 'space-y-6 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 sm:p-8 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

export function TextField({ label, value, onChange, type = 'text', area = false, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; area?: boolean; placeholder?: string; required?: boolean }) {
  const id = useId()
  return <label className="block text-sm font-medium" htmlFor={id}>{label}{area
    ? <textarea id={id} className={setupInput} value={value} onChange={e => onChange(e.target.value)} rows={3} maxLength={2000} placeholder={placeholder} required={required} />
    : <input id={id} className={setupInput} type={type} value={value} onChange={e => onChange(e.target.value)} maxLength={500} placeholder={placeholder} required={required} />}</label>
}
function Choice({ label, value, options, onChange }: { label: string; value: string; options: readonly string[] | Record<string, string>; onChange: (value: string) => void }) {
  const id = useId()
  const entries = Array.isArray(options) ? options.map(value => [value, value.replaceAll('_', ' ')]) : Object.entries(options)
  return <label className="block text-sm font-medium" htmlFor={id}>{label}<select id={id} className={setupInput} value={value} onChange={e => onChange(e.target.value)}><option value="">Not known yet</option>{entries.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
}
export function IntakeFields({ value, onChange, section = 'all' }: { value?: SetupIntake; onChange: (value: SetupIntake) => void; section?: 'identity' | 'contacts' | 'products' | 'sources' | 'all' }) {
  const data = value ?? emptyIntake()
  const update = (patch: Partial<SetupIntake>) => onChange({ ...data, ...patch })
  const show = (name: string) => section === 'all' || section === name
  return <div className="space-y-6">
    {show('identity') && <fieldset className="space-y-4"><legend className="mb-3 text-lg font-semibold">Property purpose and location</legend><p className="text-sm">Choose what you know. Unspecified details will remain open for review.</p><div className="grid gap-4 sm:grid-cols-2">
      <Choice label="Subject" value={data.subjectKind} options={{ real_estate_property: 'Property', real_estate_development: 'Development', real_estate_portfolio: 'Portfolio', business_location: 'Business location', other: 'Other organization or destination' }} onChange={subjectKind => update({ subjectKind: subjectKind as SetupIntake['subjectKind'] })} />
      <Choice label="Site scope" value={data.scope} options={['property', 'community', 'development', 'corporate', 'portfolio', 'destination']} onChange={scope => update({ scope: scope as SetupIntake['scope'] })} />
      <Choice label="Sector" value={data.sector} options={['residential', 'senior_care', 'commercial', 'cross_sector', 'destination']} onChange={sector => update({ sector: sector as SetupIntake['sector'] })} />
      <Choice label="Business model" value={data.transaction} options={{ rental: 'Rental', for_sale: 'For sale', care_services: 'Care services', commercial_lease: 'Commercial leasing', informational: 'Information only', destination_booking: 'Destination booking' }} onChange={transaction => update({ transaction: transaction as SetupIntake['transaction'] })} />
      <Choice label="Lifecycle" value={data.lifecycle} options={['operating', 'prelaunch', 'lease_up', 'selling']} onChange={lifecycle => update({ lifecycle: lifecycle as SetupIntake['lifecycle'] })} />
      <Choice label="Offering type" value={data.offeringKind} options={['rental_unit', 'bed_space', 'rental_home', 'home_plan', 'quick_move_in_home', 'homesite', 'care_residence', 'commercial_suite', 'commercial_building', 'land', 'venue', 'event', 'portfolio_property']} onChange={offeringKind => update({ offeringKind: offeringKind as SetupIntake['offeringKind'] })} />
      <TextField label="Country" value={data.country} onChange={country => update({ country })} placeholder="United States" />
      <TextField label="Property timezone" value={data.timezone} onChange={timezone => update({ timezone })} placeholder="America/Los_Angeles" />
    </div><details><summary className="cursor-pointer font-medium">Identity, ownership and market details</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <TextField label="Canonical public name" value={data.canonicalName} onChange={canonicalName => update({ canonicalName })} />
      <TextField label="Other property names" value={data.aliases} onChange={aliases => update({ aliases })} />
      <TextField label="Owner or developer" value={data.ownershipEntity} onChange={ownershipEntity => update({ ownershipEntity })} />
      <TextField label="Management company" value={data.managementCompany} onChange={managementCompany => update({ managementCompany })} />
      <TextField label="Market" value={data.market} onChange={market => update({ market })} /><TextField label="Submarket" value={data.submarket} onChange={submarket => update({ submarket })} />
    </div></details></fieldset>}
    {show('contacts') && <fieldset className="space-y-4"><legend className="mb-3 text-lg font-semibold">Public contact and conversion</legend><p className="text-sm">These details may appear on public pages. Internal and billing contacts below stay separate.</p><div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Public contact name" value={data.publicContact.name} onChange={name => update({ publicContact: { ...data.publicContact, name, confirmed: false } })} />
      <TextField label="Public phone" type="tel" value={data.publicContact.phone} onChange={phone => update({ publicContact: { ...data.publicContact, phone, confirmed: false } })} />
      <TextField label="Public email" type="email" value={data.publicContact.email} onChange={email => update({ publicContact: { ...data.publicContact, email, confirmed: false } })} />
      <TextField label="Tour scheduling URL" type="url" value={data.tourUrl} onChange={tourUrl => update({ tourUrl })} />
      <TextField label="Application URL" type="url" value={data.applicationUrl} onChange={applicationUrl => update({ applicationUrl })} />
      <TextField label="Office hours" value={data.officeHours} onChange={officeHours => update({ officeHours })} />
    </div><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={data.publicContact.confirmed} disabled={!data.publicContact.email || !data.publicContact.phone} onChange={e => update({ publicContact: { ...data.publicContact, confirmed: e.target.checked } })} /><span>I confirm this phone and email are intended for public use.</span></label></fieldset>}
    {show('products') && <fieldset className="space-y-4"><legend className="mb-3 text-lg font-semibold">Products and outcomes</legend><p className="text-sm">Your choices determine the next setup tasks. You can change them later.</p><div className="grid gap-3 sm:grid-cols-2">{Object.entries(SETUP_PRODUCTS).map(([key, label]) => <label key={key} className="flex items-center gap-3 rounded-lg border border-slate-300 p-3"><input type="checkbox" checked={data.products.includes(key as SetupIntake['products'][number])} onChange={e => update({ products: e.target.checked ? [...data.products, key as SetupIntake['products'][number]] : data.products.filter(v => v !== key) })} />{label}</label>)}</div><div className="grid gap-4 sm:grid-cols-2">
      <Choice label="Primary conversion goal" value={data.primaryIntent} options={['inquiry', 'tour', 'visit', 'private_appointment', 'apply', 'register_interest', 'waitlist', 'pricing_availability_request', 'brochure_request', 'broker_registration', 'sales_inquiry', 'commercial_leasing_inquiry', 'rfp', 'professional_referral', 'directions', 'external_booking']} onChange={primaryIntent => update({ primaryIntent: primaryIntent as SetupIntake['primaryIntent'] })} />
      <TextField label="Setup owner" value={data.setupOwner} onChange={setupOwner => update({ setupOwner })} /><TextField label="Target launch date" type="date" value={data.launchTarget} onChange={launchTarget => update({ launchTarget })} />
      <TextField label="Success metric" value={data.successMetric} onChange={successMetric => update({ successMetric })} placeholder="Qualified tours per month" /><TextField label="Success target and period" value={data.successTarget} onChange={successTarget => update({ successTarget })} placeholder="Confirm a baseline before setting a target" />
    </div></fieldset>}
    {show('sources') && <fieldset className="space-y-4"><legend className="mb-3 text-lg font-semibold">Authoritative sources</legend><p className="text-sm">Record where approved information comes from. References do not authorize accounts, import files, or publish facts. Keep passwords and tokens out of these fields.</p>
      {data.sources.map((source, index) => <fieldset key={source.id} className="space-y-3 rounded-xl border border-slate-300 p-4"><legend>Source {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2">
        <Choice label={`Source ${index + 1} type`} value={source.kind} options={SOURCE_KINDS} onChange={kind => update({ sources: data.sources.map(s => s.id === source.id ? { ...s, kind: (kind || 'website') as typeof source.kind } : s) })} />
        {(['label', 'reference', 'provider', 'externalId', 'owner', 'observedAt', 'reviewAfter'] as const).map(key => <TextField key={key} label={`Source ${index + 1} ${{ label: 'name', reference: 'URL or folder link', provider: 'provider', externalId: 'account or property reference', owner: 'owner', observedAt: 'observation date', reviewAfter: 'review date' }[key]}`} type={key.endsWith('At') || key === 'reviewAfter' ? 'date' : 'text'} value={source[key]} onChange={value => update({ sources: data.sources.map(s => s.id === source.id ? { ...s, [key]: value } : s) })} />)}
        <Choice label={`Source ${index + 1} intended audience`} value={source.visibility} options={{ internal: 'Internal only', portal: 'Client portal after review', public: 'Public after review' }} onChange={visibility => update({ sources: data.sources.map(s => s.id === source.id ? { ...s, visibility: (visibility || 'internal') as typeof source.visibility } : s) })} />
      </div><TextField label={`Source ${index + 1} scope and refresh notes`} area value={source.notes} onChange={notes => update({ sources: data.sources.map(s => s.id === source.id ? { ...s, notes } : s) })} /><button type="button" className={setupButton} onClick={() => update({ sources: data.sources.filter(s => s.id !== source.id) })}>Remove source {index + 1}</button></fieldset>)}
      <button type="button" className={setupButton} disabled={data.sources.length >= 20} onClick={() => update({ sources: [...data.sources, newSourcePlan()] })}>Add source reference</button>
      <details><summary className="cursor-pointer font-medium">Brand, audience and review responsibilities</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Choice label="Brand setup" value={data.brandMode} options={{ existing: 'Use an existing brand', new: 'Develop a new brand', later: 'Decide later' }} onChange={brandMode => update({ brandMode: brandMode as SetupIntake['brandMode'] })} /><TextField label="Brand voice notes" area value={data.brandVoice} onChange={brandVoice => update({ brandVoice })} /><TextField label="Audience and positioning notes" area value={data.audience} onChange={audience => update({ audience })} /><TextField label="Property legal entity" value={data.legalEntity} onChange={legalEntity => update({ legalEntity })} /><TextField label="Jurisdiction" value={data.jurisdiction} onChange={jurisdiction => update({ jurisdiction })} /><TextField label="Review coordinator" value={data.reviewer} onChange={reviewer => update({ reviewer })} /></div><p className="mt-3 text-sm">Brand rights, property facts, inventory, disclosures and consent are reviewed in their dedicated setup tasks before use.</p></details>
    </fieldset>}
  </div>
}
