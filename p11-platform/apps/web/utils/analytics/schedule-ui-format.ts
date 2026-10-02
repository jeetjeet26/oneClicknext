export { metricCurrency } from './report-data';
export function formatScheduleAction(action: string) { return action.replace(/^bi\./, '').replaceAll('.', ' ').replaceAll('_', ' '); }
