import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
const pendingSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('save'), id }).strict(),
    z.object({ kind: z.literal('export'), id, reportId: id, format: z.enum(['csv', 'pdf']), outcome: z.enum(['download_started', 'download_failed']).optional() }).strict(),
]);
export type PendingBi = z.infer<typeof pendingSchema>;
export const biPendingKey = (actorId: string, propertyId: string) => `p11.bi-report.v1:${actorId}:${propertyId}`;
export function parseBiPending(raw: string | null): PendingBi | null { if (!raw)
    return null; try {
    const result = pendingSchema.safeParse(JSON.parse(raw));
    if (result.success)
        return result.data;
}
catch { } throw new Error('This browser has an unreadable report request. Keep this tab and contact your administrator.'); }
export class BiClientError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}
export async function biRequest(propertyId: string, params: Record<string, string> | Record<string, unknown>, method: 'GET' | 'POST' = 'GET', signal?: AbortSignal, actorId?: string) {
    const query = new URLSearchParams(method === 'GET' ? { ...params as Record<string, string>, propertyId } : {});
    const response = await fetch('/api/analytics/reports' + (method === 'GET' ? '?' + query : ''), { method, signal, cache: 'no-store', ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, propertyId, expectedActorId: actorId }) } : {}) });
    const result = await response.json();
    if (!response.ok)
        throw new BiClientError(result.error || 'Report history could not be confirmed.', response.status);
    if (result.propertyId !== propertyId || params.id && (method === 'POST' || params.kind === 'detail' || params.kind === 'export') && result.id !== params.id || method === 'GET' && actorId && result.actorId !== actorId)
        throw new Error('The report response does not match this account or request.');
    return result;
}
