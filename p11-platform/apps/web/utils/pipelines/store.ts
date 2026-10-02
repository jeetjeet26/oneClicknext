import { createServiceClient } from '@/utils/supabase/admin';
import { InventoryError } from '@/utils/knowledge/inventory';
export { biActor as pipelineActor } from '@/utils/analytics/report-store';
export { InventoryError };
const messages: Record<string, string> = { forbidden: 'An administrator or manager with current property access can control imports.', not_found: 'This import or request is unavailable in this property.', invalid_input: 'Review the selected accounts, period and decision.', request_conflict: 'This request differs from its recorded result. Check its saved result.', job_changed: 'The import changed. Refresh and review its progress before deciding.', retry_unavailable: 'Only a stopped, partial or failed tracked import can be retried. Review historical jobs separately.', stop_unavailable: 'This job cannot be stopped through the tracked importer.', open_import: 'An import is already queued or running. Review it before requesting another.', accounts_changed: 'A selected account changed or is no longer active. Review the current connections.', history_changed: 'History changed. Refresh before loading another page.' };
export async function pipelineRpc(name: string, args: Record<string, unknown>) {
    const client = createServiceClient();
    const { data, error } = await (client as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
        }>;
    }).rpc(name, args);
    if (error || !data)
        throw new InventoryError('Import history could not be confirmed. Check the saved request before trying again.', 503);
    if (!['ready', 'saved', 'replayed'].includes(String(data.state)))
        throw new InventoryError(messages[String(data.state)] || 'Import result could not be confirmed.', data.state === 'forbidden' ? 403 : data.state === 'not_found' ? 404 : 409);
    if (data.propertyId !== args.p_property_id || args.p_id && data.id !== args.p_id)
        throw new InventoryError('The import response does not match the request.', 503);
    return data;
}
