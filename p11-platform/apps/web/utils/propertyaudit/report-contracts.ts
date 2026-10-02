import { z } from 'zod';
export const auditReportId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const reportOptions = z.object({ format: z.enum(['html', 'markdown', 'findings_csv', 'queries_csv']), template: z.enum(['executive', 'comprehensive', 'competitive', 'progress']), sections: z.array(z.enum(['summary', 'scores', 'models', 'competitors', 'recommendations', 'queries', 'appendix'])).min(1).max(7).refine(v => new Set(v).size === v.length), runId: auditReportId.optional(), batchId: auditReportId.optional(), includeFixed: z.boolean().optional() }).strict().refine(v => !(v.runId && v.batchId));
const identity = { id: auditReportId, propertyId: auditReportId, expectedActorId: auditReportId };
export const reportDecision = z.discriminatedUnion('operation', [
    z.object({ ...identity, operation: z.literal('prepare'), options: reportOptions }).strict(),
    z.object({ ...identity, operation: z.literal('resume') }).strict(),
    z.object({ ...identity, operation: z.literal('cancel') }).strict(),
    z.object({ ...identity, operation: z.literal('download'), reportId: auditReportId }).strict(),
    z.object({ ...identity, operation: z.literal('observe'), reportId: auditReportId, outcome: z.enum(['download_initiated', 'print_view_opened', 'blocked', 'failed']) }).strict()
]);
export const reportRead = z.object({ propertyId: auditReportId, id: auditReportId.optional(), offset: z.coerce.number().int().min(0).max(1000000).default(0), hash: z.string().regex(/^[0-9a-f]{64}$/).optional(), artifact: z.enum(['1']).optional(), downloadId: auditReportId.optional() }).strict().refine(v => !v.artifact || (!!v.id && !!v.downloadId));
export type AuditReportOptions = z.infer<typeof reportOptions>;
