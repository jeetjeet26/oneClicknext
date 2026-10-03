import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
const identity = { propertyId: id, expectedActorId: id, id };
export const pipelineCommand = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('start'), connectionsHash: z.string().regex(/^[a-f0-9]{64}$/), connectionIds: z.array(id).min(1).max(100).refine(v => new Set(v).size === v.length), dateRange: z.enum(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH']) }).strict(),
    z.object({ ...identity, operation: z.enum(['stop', 'retry', 'review']), jobId: id, revision: z.number().int().min(1).max(999999999), note: z.string().trim().max(2000).refine(v => !v.includes('\u0000')) }).strict(),
    z.object({ ...identity, operation: z.literal('cancel_request') }).strict()
]);
export const pipelineRead = z.object({ propertyId: id, kind: z.enum(['list', 'job', 'history', 'command']).default('list'), id: id.optional(), offset: z.coerce.number().int().min(0).max(1000000).default(0), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(v => v.kind === 'list' || !!v.id);
export const pendingPipeline = z.object({ id }).strict();
