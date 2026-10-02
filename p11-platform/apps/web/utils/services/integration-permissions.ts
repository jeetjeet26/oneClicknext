import type {IntegrationCapability, IntegrationProvider} from './integration-provider-config'
function normalizeGraphScope(scope: string): string {
 const decoded = decodeURIComponent(scope)
 if (!/^[\x21-\x7E]+$/.test(decoded)) throw new Error('Invalid permission name')
 return decoded.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()
}
export type PermissionState = 'confirmed' | 'permissions_unconfirmed' | 'permissions_incomplete'
export function integrationPermissionState(provider: IntegrationProvider, capability: IntegrationCapability, scopes: unknown, metadata: unknown): PermissionState {
 if (!['google','microsoft'].includes(provider) || !['calendar','email'].includes(capability)) return 'permissions_unconfirmed'
 const evidence = metadata && typeof metadata === 'object' && 'scopeEvidence' in metadata ? metadata.scopeEvidence : null
 if (!['provider_response','refresh_inherited',...(provider === 'microsoft' ? ['microsoft_request_contract'] : [])].includes(String(evidence)) || !Array.isArray(scopes) || !scopes.length || scopes.length > 100 || scopes.some(scope => typeof scope !== 'string' || !scope || scope.length > 1024 || /\s/.test(scope))) return 'permissions_unconfirmed'
 let permissions: Set<string>
 try { permissions = new Set(scopes.map(scope => provider === 'google' ? scope : normalizeGraphScope(scope))) }
 catch { return 'permissions_unconfirmed' }
 const has = (scope: string) => permissions.has(scope)
 const allowed = provider === 'google'
  ? capability === 'calendar' ? has('https://www.googleapis.com/auth/calendar') : has('https://www.googleapis.com/auth/gmail.modify') || has('https://mail.google.com/')
  : has('user.read') && (capability === 'calendar' ? has('calendars.readwrite') : has('mail.send') && (has('mail.read') || has('mail.readwrite')))
 return allowed ? 'confirmed' : 'permissions_incomplete'
}
/** Preserve omitted vs explicitly invalid scope without storing arbitrary provider data. */
export function refreshedScopeEvidence(payload: Record<string, unknown>): {scope?: string | null} {
 return Object.hasOwn(payload, 'scope') ? {scope: typeof payload.scope === 'string' && payload.scope.length <= 16384 ? payload.scope : null} : {}
}
