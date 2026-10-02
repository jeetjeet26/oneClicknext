import { scheduleRpc } from './schedule-store';
import { BiError } from './report-store';
export { biActor as goalActor, BiError } from './report-store';
const messages: Record<string, string> = { forbidden: 'Only a current property administrator or manager can change goals.', not_found: 'This goal or request is unavailable to your account.', invalid_input: 'Review the metric, period and positive target.', goal_changed: 'This goal changed. Refresh and review it before trying again.', duplicate_goal: 'A goal already exists for this metric and period. Edit it, or restore it from archived goals.', archived_goal: 'Restore this goal before editing it.', request_conflict: 'This request differs from its recorded result. Check its history.', history_changed: 'Goals or history changed. Refresh before loading another page.' };
export async function goalRpc(name: string, args: Record<string, unknown>) {
    const result = await scheduleRpc(name, args);
    if (!['ready', 'saved', 'replayed'].includes(String(result.state)))
        throw new BiError(messages[String(result.state)] || 'The goal result could not be confirmed.', result.state === 'forbidden' ? 403 : result.state === 'not_found' ? 404 : 409);
    if (result.propertyId !== args.p_property_id || args.p_id && result.id !== args.p_id)
        throw new BiError('The goal result does not match this property or request.');
    return result;
}
