import { z } from 'zod';
import { propertyIdSchema as id } from '@/utils/property-setup/contracts';
const text = (max: number) => z.string().trim().max(max).refine(v => !v.includes('\u0000'));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const leadFields = z.object({ firstName: text(120).refine(Boolean), lastName: text(120).refine(Boolean), email: text(254).refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)), phone: text(40).refine(v => !v || /^[+0-9(). x-]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 20), source: text(120).refine(Boolean), bedrooms: text(40), moveInDate: text(10).refine(v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= '2100-12-31'), notes: text(8000) }).strict().refine(v => !!v.email || !!v.phone);
const identity = { propertyId: id, expectedActorId: id, id }, existing = { leadId: id, revision: z.number().int().min(1).max(999999999) }, duplicate = { duplicateHash: hash.optional(), duplicateReason: text(2000) }, followup = { workflowIds: z.array(id).max(10).refine(v => new Set(v).size === v.length), workflowHash: hash };
export const leadRecordCommand = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('create'), fields: leadFields, ...duplicate, ...followup, prepareCrm: z.boolean() }).strict(),
    z.object({ ...identity, operation: z.literal('edit'), ...existing, fields: leadFields, ...duplicate }).strict(),
    z.object({ ...identity, operation: z.literal('status'), ...existing, status: z.enum(['new', 'contacted', 'tour_booked', 'toured', 'leased', 'lost']), reason: text(2000) }).strict(),
    z.object({ ...identity, operation: z.literal('start_followup'), ...existing, ...followup }).strict(),
    z.object({ ...identity, operation: z.literal('prepare_crm'), ...existing }).strict(),
    z.object({ ...identity, operation: z.literal('cancel_request') }).strict()
]);
export const leadRecordRead = z.object({ propertyId: id, kind: z.enum(['list', 'context', 'lead', 'history', 'command']).default('list'), id: id.optional(), offset: z.coerce.number().int().min(0).max(1000000).default(0), page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), search: text(200).default(''), status: text(120).optional(), source: text(120).optional(), sortBy: z.enum(['created_at', 'updated_at', 'first_name', 'last_name', 'status', 'source']).default('created_at'), sortOrder: z.enum(['asc', 'desc']).default('desc'), expectedHash: hash.optional() }).strict().refine(v => ['list', 'context'].includes(v.kind) || !!v.id);
export const pendingLeadRecord = z.object({ id }).strict();
export type LeadFields = z.infer<typeof leadFields>;
