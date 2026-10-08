import { z } from 'zod'

export const packageRequestSchema = z.object({
  requestId: z.uuid(), propertyId: z.guid(), parentId: z.uuid().nullable().default(null),
  target: z.enum(['wordpress', 'standalone']),
  instructions: z.string().trim().min(1).max(8000),
}).strict()
export type PackageRequest = z.infer<typeof packageRequestSchema>
export type PackageState = 'queued' | 'preparing' | 'starting' | 'generating' | 'packaging' | 'ready' | 'failed' | 'uncertain'
export type PackageSummary = {
  id: string; target: 'wordpress' | 'standalone'; instructions: string; state: PackageState;
  parent_id: string | null; created_at: string; error_message: string | null;
  source_hash: string; package_bytes: number | null;
}
export type PackageSourceSummary = {
  name: string; hash: string; floorplans: number; assets: number;
  brand: boolean; direction: boolean; warnings: string[];
}
export class PackageError extends Error {
  constructor(message: string, readonly status = 503) { super(message) }
}
