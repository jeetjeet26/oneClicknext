import { createServiceClient } from '@/utils/supabase/admin';
import { InventoryError } from '@/utils/knowledge/inventory';
export { biActor as auditActor } from '@/utils/analytics/report-store';
export { InventoryError };
const messages: Record<string, string> = { review_required: 'Review the existing saved work before starting another request or changing its state.', saved_receipt_required: 'Only a saved successful provider response can resume without another model call.', invalid_parent: 'Choose a closed recommendation request from this property and batch.', incomplete_evaluation: 'Every retained answer must have a complete evaluation before application.', completed_run_required: 'The selected audit evidence is not complete enough for this operation. Review its measurement and crawl status.', source_limit: 'This report source exceeds the supported size. Choose a single run.', artifact_limit: 'This artifact exceeds the supported size. Choose fewer report sections.', cancelled: 'This saved report request was cancelled.', forbidden: 'Your account does not have permission for this audit action in the current property.', not_found: 'This audit record is unavailable in the current property.', invalid_input: 'Review the audit fields and exact selection.', request_conflict: 'This request differs from its saved decision. Check its result before continuing.', source_changed: 'The source evidence changed. Refresh and review it again.', query_changed: 'The query changed. Refresh before saving another decision.', query_conflict: 'A current question already uses this wording. Review it before adding or restoring another.', run_changed: 'The audit state changed. Refresh its current result before deciding.', run_open: 'Stop the active audit before archiving or reviewing its result.', query_limit: 'Select between 1 and 300 question executions per surface.', daily_limit: 'The property has reached its daily audit limit. Review existing work before requesting more.', legacy_source_unavailable: 'This older run has no complete captured question source. Review the current configuration for a new run.', history_changed: 'The audit inventory changed. Refresh before loading another page.' };
export async function auditRpc(name: string, args: Record<string, unknown>) {
    const client = createServiceClient();
    const { data, error } = await (client as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
        }>;
    }).rpc(name, args);
    if (error || !data)
        throw new InventoryError('The audit result could not be confirmed. Check the saved request before trying again.', 503);
    if (!['ready', 'saved', 'replayed'].includes(String(data.state)))
        throw new InventoryError(messages[String(data.state)] || 'The audit result could not be confirmed.', data.state === 'forbidden' ? 403 : data.state === 'not_found' ? 404 : 409);
    if (data.propertyId !== args.p_property_id || args.p_id && data.id !== args.p_id)
        throw new InventoryError('The audit response does not match the current request.', 503);
    return data;
}
