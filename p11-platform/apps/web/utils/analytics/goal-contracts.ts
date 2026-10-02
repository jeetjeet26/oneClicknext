import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
export const goalMetric = z.enum(['spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpa']);
export const goalPeriod = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
const identity = { propertyId: id, expectedActorId: id, id };
const revision = z.number().int().min(0).max(999999999);
export const goalValues = z.object({ metric: goalMetric, period: goalPeriod, target: z.number().finite().positive().max(1e12), direction: z.enum(['at_least', 'at_most']), threshold: z.number().int().min(1).max(100) }).strict().refine(v => v.metric !== 'ctr' || v.target <= 100, { message: 'CTR targets cannot exceed 100%.' }).refine(v => !['clicks', 'impressions'].includes(v.metric) || Number.isInteger(v.target), { message: 'Use a whole number for clicks and impressions.' });
export const goalCommand = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('save'), goalId: id, expectedRevision: revision, ...goalValues.shape }).strict().refine(v => goalValues.safeParse({ metric: v.metric, period: v.period, target: v.target, direction: v.direction, threshold: v.threshold }).success),
    z.object({ ...identity, operation: z.enum(['archive', 'restore']), goalId: id, expectedRevision: revision }).strict(),
    z.object({ ...identity, operation: z.literal('cancel_request') }).strict()
]);
export const goalRead = z.object({ propertyId: id, kind: z.enum(['goals', 'history', 'command']).default('goals'), id: id.optional(), offset: z.coerce.number().int().min(0).max(1e6).default(0), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(v => v.kind !== 'command' || !!v.id);
export const pendingGoal = z.object({ id }).strict();
export type GoalValues = z.infer<typeof goalValues>;
export type MetricGoal = {
    id: string;
    property_id: string;
    metric_key: GoalValues['metric'];
    goal_type: GoalValues['period'];
    target_value: number;
    is_inverse: boolean;
    alert_threshold_percent: number;
    is_active: boolean;
    revision: number;
    created_at: string;
    updated_at: string;
};
