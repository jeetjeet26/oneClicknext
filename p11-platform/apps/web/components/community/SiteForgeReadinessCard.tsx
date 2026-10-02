'use client'
import {ReadinessReviewWorkbench} from './ReadinessReviewWorkbench'
type SiteForgeCapability='crm'|'tours'|'chatbot'|'analytics'
const remediation: Record<string, string> = {
  identityContact: '/dashboard/properties',
  brand: '/dashboard/brandforge',
  assets: '/dashboard/community',
  propertyFacts: '/dashboard/community',
  units: '/dashboard/community',
  neighborhood: '/dashboard/community',
  legal: '/dashboard/community',
  integrations: '/dashboard/settings/crm',
}

export function readinessRemediationUrl(
  domain: string,
  propertyId: string,
): string {
  return domain === 'brand'
    ? `/dashboard/brandforge/${propertyId}`
    : remediation[domain] || '/dashboard/community'
}

export const SITEFORGE_CAPABILITIES: Array<{
  value: SiteForgeCapability
  label: string
}> = [
  { value: 'crm', label: 'CRM lead delivery' },
  { value: 'tours', label: 'Tour scheduling' },
  { value: 'chatbot', label: 'Property chatbot' },
  { value: 'analytics', label: 'Analytics and tag manager' },
]

export function SiteForgeReadinessCard({propertyId,onChanged}:{propertyId:string;onChanged?:()=>void}){return<ReadinessReviewWorkbench key={propertyId} propertyId={propertyId} onChanged={onChanged}/>}
