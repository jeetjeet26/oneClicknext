import { scheduleRpc } from './schedule-store';
import { BiError } from './report-store';
export { biActor as queryActor, BiError } from './report-store';
export { scheduleRpc as queryRaw } from './schedule-store';
const messages: Record<string, string> = { forbidden: 'This query requires current access to its property.', not_found: 'This query or request is unavailable to your account.', invalid_input: 'Review the question and query controls.', invalid_plan: 'Choose dates and filters within this query’s saved report.', source_changed: 'Report data changed. Refresh it before preparing a query.', query_changed: 'This query changed. Reload its saved state before deciding.', closed_query: 'This query is complete or cancelled. Start a new query for another result.', request_conflict: 'This request differs from its saved result. Check its history.', history_changed: 'Query history changed. Refresh before loading another page.', invalid_result: 'The full query result could not be retained. Review a smaller date range.' };
export async function queryRpc(name: string, args: Record<string, unknown>) {
    const result = await scheduleRpc(name, args);
    if (!['ready', 'saved', 'replayed'].includes(String(result.state)))
        throw new BiError(messages[String(result.state)] || 'The query result could not be confirmed.', result.state === 'forbidden' ? 403 : result.state === 'not_found' ? 404 : 409);
    if (result.propertyId !== args.p_property_id || args.p_id && result.id !== args.p_id)
        throw new BiError('The query response does not match this property or request.');
    return result;
}
