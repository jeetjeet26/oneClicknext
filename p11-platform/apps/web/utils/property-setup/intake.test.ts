import { describe, expect, it } from 'vitest'
import { emptyIntake, intakeSchema, publicContactFromProperty, newSourcePlan, intakeForEditing } from './intake'
import { creationProfile } from './creation-contracts'
import { snapshotFromForm, formFromSnapshot } from './form'
import { draftFromForm, formFromDraft } from './organization-contracts'
import { propertyDraftSchema } from './draft-contracts'
import { propertyContextFromOnboardingSnapshot } from '@/utils/siteforge/property-context'

const intake = { ...emptyIntake(), subjectKind: 'real_estate_development' as const, scope: 'development' as const, sector: 'residential' as const, transaction: 'for_sale' as const, lifecycle: 'prelaunch' as const, offeringKind: 'home_plan' as const, primaryIntent: 'register_interest' as const, country: 'Canada', timezone: 'America/Vancouver', canonicalName: 'Exact canonical identity', aliases: 'Alternate identity', ownershipEntity: 'Owner entity', managementCompany: 'Manager', market: 'Metro', submarket: 'District', products: ['website', 'leads'] as Array<'website'|'leads'>, setupOwner: 'Setup owner', launchTarget: '2027-01-01', successMetric: 'Qualified inquiries', successTarget: '100 each quarter', publicContact: { name: 'Sales team', phone: '+1 555 0100', email: 'public@example.test', confirmed: true }, tourUrl: 'https://example.test/tour', applicationUrl: 'https://example.test/register', officeHours: 'Weekdays, 9–5', brandMode: 'existing' as const, brandVoice: 'Calm and clear', audience: 'Supplied audience', legalEntity: 'Legal entity', jurisdiction: 'BC', reviewer: 'Review owner', sources: [{ ...newSourcePlan(), kind: 'google_drive' as const, label: 'Current source folder', reference: 'https://drive.google.com/drive/folders/example', provider: 'Google Drive', externalId: 'property-reference', owner: 'Content owner', observedAt: '2026-10-30', reviewAfter: '2026-11-30', visibility: 'internal' as const, notes: 'Review every month' }] }
const community = { name: 'Setup fixture', type: '' as const, address: { street: '1 Street', city: 'City', state: 'BC', zip: 'V0A' }, websiteUrl: '', additionalUrls: [], unitCount: '0', yearBuilt: '', amenities: [], intake }
const form = { organization: { name: 'Organization', type: 'developer' as const, legalName: 'Org legal' }, community, contacts: [], integrations: [], documents: [] }

describe('shared onboarding intake', () => {
  it('round trips every intake field equivalently through both entry paths', () => {
    const property = snapshotFromForm(form)
    const organization = draftFromForm(form, 'review')
    expect(property.profile).toEqual(organization.profile)
    expect(formFromSnapshot(property).community.intake).toEqual(intake)
    expect(formFromDraft(organization).community.intake).toEqual(intake)
    expect(property.profile.unitCount).toBe(0)
    expect(property.profile.yearBuilt).toBeNull()
  })
  it('retains unknown classification and contacts in a private draft without inventing values', () => {
    const profile = creationProfile({ ...community, intake: emptyIntake() })
    const draft = propertyDraftSchema.parse({ profile, contacts: [], connectionRequests: [], step: 'contacts' })
    expect(draft.profile.intake?.transaction).toBe('')
    expect(draft.profile.intake?.sources).toEqual([])
    expect(draft.profile.intake?.publicContact.confirmed).toBe(false)
  })
  it('rejects fabricated states, duplicate sources, invalid dates, timezone and credential URLs', () => {
    for (const change of [{ timezone: 'Made/Up' }, { products: ['website', 'website'] }, { sources: [intake.sources[0], intake.sources[0]] }, { sources: [{ ...intake.sources[0], reference: 'https://secret:password@example.test' }] }, { sources: [{ ...intake.sources[0], reviewAfter: '2020-01-01' }] }, { connected: true }]) {
      expect(intakeSchema.safeParse({ ...intake, ...change }).success).toBe(false)
    }
  })
  it('requires both public contact channels before confirming public use', () => {
    expect(intakeSchema.safeParse({ ...intake, publicContact: { ...intake.publicContact, phone: '' } }).success).toBe(false)
    expect(publicContactFromProperty({ settings: { publicContact: { ...intake.publicContact, confirmed: false } } })).toBeNull()
  })
  it('uses only the confirmed public contact in website context and leaves country unknown', () => {
    const property = { id: 'property', name: 'Property', settings: {}, address: {} }
    const privateContact = { name: 'Internal owner', email: 'internal@example.test', phone: 'private', is_primary: true }
    expect(propertyContextFromOnboardingSnapshot({ property, contacts: [privateContact] })).toMatchObject({ phone: undefined, email: undefined, address: { country: '' } })
    expect(propertyContextFromOnboardingSnapshot({ property: { ...property, settings: { publicContact: intake.publicContact } }, contacts: [privateContact] })).toMatchObject({ phone: intake.publicContact.phone, email: intake.publicContact.email })
  })
  it('preserves template guidance and other saved canonical fields when resuming setup', () => {
    const snapshot = snapshotFromForm(form)
    snapshot.profile.brandVoice = 'Reviewed template voice'
    snapshot.profile.targetAudience = 'Reviewed template audience'
    snapshot.profile.specialFeatures = ['Reviewed feature']
    expect(snapshotFromForm(formFromSnapshot(snapshot), snapshot).profile).toMatchObject({ brandVoice: 'Reviewed template voice', targetAudience: 'Reviewed template audience', specialFeatures: ['Reviewed feature'] })
  })
})

it('seeds a legacy editor from existing canonical fields without changing its saved snapshot',()=>{const profile={brandVoice:'Approved voice',targetAudience:'Current audience'};const seeded=intakeForEditing(profile,{address:{country:'Canada'},settings:{timezone:'America/Toronto'}});expect(seeded).toMatchObject({country:'Canada',timezone:'America/Toronto',brandVoice:'Approved voice',audience:'Current audience'});expect(profile).not.toHaveProperty('intake')})
