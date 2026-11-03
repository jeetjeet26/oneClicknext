import type { OnboardingFormData } from '@/app/onboarding/types'
import { creationProfile } from './creation-contracts'
import type { SetupSnapshot } from './contracts'

export type SetupForm = Pick<OnboardingFormData, 'community' | 'contacts' | 'integrations'>
export function snapshotFromForm(form: SetupForm, prior?: SetupSnapshot | null): SetupSnapshot {
  return {
    profile: { ...creationProfile(form.community), specialFeatures: prior?.profile.specialFeatures || [], brandVoice: form.community.intake?.brandVoice ?? prior?.profile.brandVoice ?? '', targetAudience: form.community.intake?.audience ?? prior?.profile.targetAudience ?? '' },
    contacts: form.contacts.map(c => ({ id: c.id, type: c.type, name: c.name, email: c.email, phone: c.phone || '', role: c.role || '', billingAddress: c.billingAddress || { street: '', city: '', state: '', zip: '' }, billingMethod: c.billingMethod || '', specialInstructions: c.specialInstructions || '', needsW9: c.needsW9 || false, isPrimary: c.type === 'primary' })),
    connectionRequests: form.integrations.map(c => ({ platform: c.platform, accountId: c.accountId || '', accountName: c.accountName || '', notes: c.notes || '' })),
  }
}
export function formFromSnapshot(snapshot: SetupSnapshot): SetupForm {
  const p = snapshot.profile
  return { community: { name: p.name, type: (p.propertyType || '') as SetupForm['community']['type'], address: p.address, websiteUrl: p.websiteUrl, additionalUrls: p.additionalUrls, unitCount: p.unitCount?.toString() ?? '', yearBuilt: p.yearBuilt?.toString() ?? '', amenities: p.amenities, intake: p.intake ? { ...p.intake, brandVoice: p.brandVoice, audience: p.targetAudience } : undefined }, contacts: snapshot.contacts.map(c => ({ ...c, billingMethod: c.billingMethod || undefined })), integrations: snapshot.connectionRequests.map(c => ({ ...c, status: 'pending' })) }
}
