import { createServiceClient } from '@/utils/supabase/admin';
import { InventoryError } from '@/utils/knowledge/inventory';
export { biActor as leadRecordActor } from '@/utils/analytics/report-store';
export { InventoryError };
export class LeadRecordError extends InventoryError {
    constructor(message: string, status: number, readonly result?: Record<string, unknown>) { super(message, status); }
}
const messages: Record<string, string> = { forbidden: 'An administrator or manager with current property access can change lead records.', not_found: 'This lead or saved request is unavailable in this property.', invalid_input: 'Review the contact fields, selected follow-up and decision.', request_conflict: 'This request differs from its saved result. Check the recorded decision.', lead_changed: 'The lead changed. Reload its current details before deciding.', contact_conflict: 'An existing lead uses this contact information. Review the matches before creating a separate record or changing these details.', followup_changed: 'The active follow-up changed. Refresh and review its current steps.', followup_open: 'This lead already has active or paused follow-up. Review it before starting another.', history_changed: 'Lead history changed. Refresh before loading another page.' };
export async function leadRecordRpc(name: string, args: Record<string, unknown>) {
    const client = createServiceClient();
    const { data, error } = await (client as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
        }>;
    }).rpc(name, args);
    if (error || !data)
        throw new InventoryError('The lead decision could not be confirmed. Check the saved request before trying again.', 503);
    if (!['ready', 'saved', 'replayed'].includes(String(data.state)))
        throw new LeadRecordError(messages[String(data.state)] || 'The lead decision could not be confirmed.', data.state === 'forbidden' ? 403 : data.state === 'not_found' ? 404 : 409, data.state === 'contact_conflict' ? { state: data.state, matches: data.matches } : undefined);
    if (data.propertyId !== args.p_property_id || args.p_id && data.id !== args.p_id)
        throw new InventoryError('The lead response does not match this request.', 503);
    return data;
}
