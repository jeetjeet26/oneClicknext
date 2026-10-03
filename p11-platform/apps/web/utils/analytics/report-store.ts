import { InventoryError } from '@/utils/knowledge/inventory';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/admin';
import { validatePropertyAccess } from '@/utils/services/auth-guard';
import { buildBiReport, type BiSource } from './report-data';
import type { BiFilters } from './report-contracts';
export { InventoryError as BiError };
export async function biActor(propertyId: string) { const { data: { user }, error } = await (await createClient()).auth.getUser(); if (error || !user)
    throw new InventoryError('Sign in to read marketing reports.', 401); if (!(await validatePropertyAccess(user.id, propertyId)).authorized)
    throw new InventoryError('This property is unavailable to your account.', 403); return user.id; }
const messages: Record<string, string> = { forbidden: 'This property is unavailable to your account.', not_found: 'This saved report or export is unavailable in this property.', invalid_filters: 'Choose valid dates up to 366 days and supported report filters.', invalid_input: 'Review the report name and filters.', source_changed: 'Marketing data changed. Reload the report before saving.', request_conflict: 'This request differs from its saved result. Check report history.', history_changed: 'Report history changed. Reload before loading more.' };
export async function biRpc(name: string, args: Record<string, unknown>, client: unknown = createServiceClient()) {
    const { data, error } = await (client as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{
            data: Record<string, unknown> | null;
            error: {
                code?: string;
            } | null;
        }>;
    }).rpc(name, args);
    if (error || !data)
        throw new InventoryError(error?.code === '22023' ? 'Choose a shorter report range; all matching rows must fit.' : 'The report could not be recorded or read. Check saved history before retrying.', error?.code === '22023' ? 400 : 503);
    if (!['ready', 'saved', 'prepared', 'replayed'].includes(String(data.state)))
        throw new InventoryError(messages[String(data.state)] || 'Report data could not be confirmed.', data.state === 'forbidden' ? 403 : data.state === 'not_found' ? 404 : 409);
    if (data.propertyId !== args.p_property_id || args.p_id && data.id !== args.p_id)
        throw new InventoryError('The report result does not match this property or request.');
    return data;
}
export async function currentBiReport(actorId: string, propertyId: string, filters: BiFilters, client?: unknown) { const r = await biRpc('bi_report_source', { p_actor_id: actorId, p_property_id: propertyId, p_filters: filters }, client); try {
    return { ...r, actorId, ...buildBiReport(r.source as BiSource) };
}
catch (e) {
    throw new InventoryError(e instanceof Error ? e.message : 'Stored report values need review.', 409);
} }
