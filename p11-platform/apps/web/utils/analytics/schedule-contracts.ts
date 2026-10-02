import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
const email = z.string().trim().toLowerCase().max(254).regex(/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/);
export const scheduleConfig = z.object({ name: z.string().trim().min(1).max(120).refine(v => !/[\r\n]/.test(v)), frequency: z.enum(['daily', 'weekly', 'monthly']), weekday: z.number().int().min(0).max(6).nullable(), monthday: z.number().int().min(1).max(28).nullable(), hour: z.number().int().min(0).max(23), window: z.enum(['previous_period', 'last_7_days', 'last_30_days', 'month_to_date']), comparison: z.boolean(), campaigns: z.boolean(), recipients: z.array(email).min(1).max(10).refine(v => new Set(v).size === v.length, 'Use each recipient once.') }).strict().refine(v => (v.frequency === 'weekly' ? v.weekday !== null : v.weekday === null) && (v.frequency === 'monthly' ? v.monthday !== null : v.monthday === null));
export type ScheduleConfig = z.infer<typeof scheduleConfig>;
const identity = { id, propertyId: id, expectedActorId: id };
export const scheduleCommand = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('create'), config: scheduleConfig }).strict(),
    z.object({ ...identity, operation: z.literal('cancel_request') }).strict(),
    z.object({ ...identity, operation: z.literal('edit'), scheduleId: id, expectedRevision: z.number().int().positive(), config: scheduleConfig }).strict(),
    z.object({ ...identity, operation: z.enum(['pause', 'resume', 'cancel', 'close_run']), scheduleId: id, expectedRevision: z.number().int().positive() }).strict(),
]);
export const schedulePreview = z.object({ operation: z.literal('preview'), propertyId: id, expectedActorId: id, config: scheduleConfig }).strict();
export const scheduleRead = z.object({ propertyId: id, kind: z.enum(['list', 'detail', 'run', 'events', 'command', 'legacy', 'legacy_detail']).default('list'), id: id.optional(), offset: z.coerce.number().int().min(0).max(2147483647).default(0), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(v => ['list', 'legacy'].includes(v.kind) || !!v.id);
export const pendingSchedule = z.object({ id }).strict();
export type BiSchedule = {
    id: string;
    property_id: string;
    authorized_by: string;
    config: ScheduleConfig;
    revision: number;
    state: 'paused' | 'active' | 'held' | 'cancelled';
    next_run_at: string | null;
    hold_reason: string | null;
    last_accepted_at: string | null;
    created_at: string;
};
