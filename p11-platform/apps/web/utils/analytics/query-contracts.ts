import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
import { biFilters } from './report-contracts';
const date = biFilters.shape.startDate, hash = z.string().regex(/^[a-f0-9]{64}$/);
export const queryPlan = z.object({ groupBy: z.enum(['none', 'day', 'week', 'month', 'channel', 'campaign']), startDate: date, endDate: date, channel: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/).nullable() }).strict().refine(v => v.endDate >= v.startDate && (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 <= 365);
export type QueryPlan = z.infer<typeof queryPlan>;
export function planFits(plan: QueryPlan, filters: z.infer<typeof biFilters>) { return plan.startDate >= filters.startDate && plan.endDate <= filters.endDate && (!plan.channel || !filters.channel || plan.channel === filters.channel); }
const identity = { propertyId: id, expectedActorId: id, id }, revision = z.number().int().min(1).max(999999999);
export const queryCommand = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('request'), mode: z.enum(['manual', 'assistant']), question: z.string().trim().min(1).max(2000), filters: biFilters, sourceHash: hash, plan: queryPlan.optional() }).strict().refine(v => v.mode === 'manual' ? !!v.plan && planFits(v.plan, v.filters) : !v.plan),
    z.object({ ...identity, operation: z.literal('revise'), queryId: id, expectedRevision: revision, plan: queryPlan }).strict(),
    z.object({ ...identity, operation: z.literal('execute'), queryId: id, expectedRevision: revision, planHash: hash }).strict(),
    z.object({ ...identity, operation: z.literal('stop'), queryId: id, expectedRevision: revision }).strict(),
    z.object({ ...identity, operation: z.literal('cancel_request') }).strict()
]);
export const queryRead = z.object({ propertyId: id, kind: z.enum(['list', 'detail', 'command', 'rows', 'history']).default('list'), id: id.optional(), offset: z.coerce.number().int().min(0).max(1000000).default(0), expectedHash: hash.optional() }).strict().refine(v => v.kind === 'list' || !!v.id);
export const pendingQuery = z.object({ id }).strict();
