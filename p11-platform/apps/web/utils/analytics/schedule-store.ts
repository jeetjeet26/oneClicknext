import { createServiceClient } from '@/utils/supabase/admin';
import { BiError } from './report-store';
export { biActor as scheduleActor, BiError } from './report-store';
const messages: Record<string, string> = { forbidden: 'This schedule requires current property access and an administrator or manager for changes.', not_found: 'This schedule or request is unavailable in this property.', invalid_input: 'Review the frequency, time and recipient addresses.', request_conflict: 'This request differs from its recorded result. Check schedule history.', schedule_changed: 'This schedule changed. Reload and review it before making another decision.', closed_schedule: 'This schedule is cancelled. Create a new schedule to start again.', open_run: 'End the unresolved run before editing or resuming future reports.', history_changed: 'Schedule history changed. Reload before loading another page.' };
export async function scheduleRpc(name: string, args: Record<string, unknown>, client: unknown = createServiceClient()) {
    const { data, error } = await (client as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
        }>;
    }).rpc(name, args);
    if (error || !data)
        throw new BiError('Schedule history could not be confirmed. Check the request result before trying again.', 503);
    return data;
}
export async function scheduleDecisionRpc(name: string, args: Record<string, unknown>) {
    const data = await scheduleRpc(name, args);
    if (!['ready', 'saved', 'replayed'].includes(String(data.state)))
        throw new BiError(messages[String(data.state)] || 'Schedule result could not be confirmed.', data.state === 'forbidden' ? 403 : data.state === 'not_found' ? 404 : 409);
    if (data.propertyId !== args.p_property_id || args.p_id && data.id !== args.p_id)
        throw new BiError('The schedule result does not match this request.');
    return data;
}
