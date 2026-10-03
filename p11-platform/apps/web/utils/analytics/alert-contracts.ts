import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
import { biFilters } from './report-contracts';
const hash = z.string().regex(/^[a-f0-9]{64}$/), identity = { propertyId: id, expectedActorId: id, id };
const choice = z.object({ key: z.string().min(1).max(80), revision: z.number().int().min(1).max(999999999) }).strict();
export const alertCommand = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('prepare'), filters: biFilters, sourceHash: hash }).strict(),
    z.object({ ...identity, operation: z.enum(['review', 'dismiss', 'restore']), setId: id, items: z.array(choice).min(1).max(50).refine(v => new Set(v.map(i => i.key)).size === v.length), note: z.string().trim().max(2000).refine(v => !v.includes('\u0000')) }).strict(),
    z.object({ ...identity, operation: z.literal('cancel_request') }).strict()
]);
export const alertRead = z.object({ propertyId: id, kind: z.enum(['list', 'items', 'history', 'command']).default('list'), id: id.optional(), bucket: z.enum(['all', 'open', 'reviewed', 'dismissed']).default('all'), offset: z.coerce.number().int().min(0).max(1000000).default(0), expectedHash: hash.optional() }).strict().refine(v => v.kind === 'list' || !!v.id);
export const pendingAlert = z.object({ id }).strict();
