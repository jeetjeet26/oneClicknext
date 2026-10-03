import { scheduleRpc } from './schedule-store';
import { BiError } from './report-store';
export { biActor as alertActor, BiError } from './report-store';
export { scheduleRpc as alertRaw } from './schedule-store';
const messages: Record<string, string> = { forbidden: 'An administrator or manager with current property access can review these changes.', not_found: 'This review or request is unavailable in this property.', invalid_input: 'Choose an exact selection of changes and a note up to 2,000 characters.', invalid_result: 'These changes could not be confirmed from the selected report.', source_changed: 'Report data changed. Refresh and review its figures before saving these changes.', alert_changed: 'One of the selected changes was reviewed elsewhere. Refresh the selection before deciding.', request_conflict: 'This request differs from its recorded result. Check review history.', history_changed: 'Review history changed. Refresh before loading another page.' };
export function alertReply(result: Record<string, unknown>, args: Record<string, unknown>) {
    if (!['ready', 'saved', 'replayed'].includes(String(result.state)))
        throw new BiError(messages[String(result.state)] || 'Alert review could not be confirmed.', result.state === 'forbidden' ? 403 : result.state === 'not_found' ? 404 : 409);
    if (result.propertyId !== args.p_property_id || args.p_id && result.id !== args.p_id)
        throw new BiError('The alert response does not match this request.');
    return result;
}
export async function alertRpc(name: string, args: Record<string, unknown>) { return alertReply(await scheduleRpc(name, args), args); }
