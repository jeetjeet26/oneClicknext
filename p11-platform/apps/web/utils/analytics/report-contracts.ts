import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Choose a valid date.');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const biFilters = z.object({ startDate: date, endDate: date, compare: z.boolean(), channel: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/).nullable(), account: z.string().max(100).nullable() }).strict().refine(v => v.endDate >= v.startDate && (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 <= 365, 'Choose up to 366 days.');
export type BiFilters = z.infer<typeof biFilters>;
export const biCommand = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('save'), propertyId: id, expectedActorId: id, id, filters: biFilters, label: z.string().trim().min(1).max(120), sourceHash: hash }).strict(),
    z.object({ operation: z.literal('cancel'), propertyId: id, expectedActorId: id, id }).strict(),
    z.object({ operation: z.literal('export'), propertyId: id, expectedActorId: id, id, reportId: id, format: z.enum(['csv', 'pdf']) }).strict(),
    z.object({ operation: z.literal('observe'), propertyId: id, expectedActorId: id, id, outcome: z.enum(['download_started', 'download_failed']) }).strict(),
]);
export const biRead = z.object({ propertyId: id, kind: z.enum(['current', 'history', 'detail', 'exports', 'export']).default('current'), id: id.optional(), offset: z.coerce.number().int().min(0).max(2147483647).default(0), expectedHash: hash.optional(), startDate: date.optional(), endDate: date.optional(), compare: z.enum(['true', 'false']).optional(), channel: z.string().max(50).optional(), account: z.string().max(100).optional() }).strict();
