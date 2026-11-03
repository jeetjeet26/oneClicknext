import { z } from 'zod'
import { profileSchema, contactSchema, connectionRequestSchema, propertyIdSchema } from './contracts'

export const propertyDraftSchema = z.object({
  profile: profileSchema,
  contacts: z.array(contactSchema.extend({ name: z.string().max(500), email: z.string().max(500) })).max(100),
  connectionRequests: z.array(connectionRequestSchema).max(11),
  step: z.enum(['community', 'contacts', 'integrations', 'knowledge', 'review']),
}).strict()
export const propertyDraftSaveSchema = z.object({
  requestId: propertyIdSchema, expectedRevision: z.number().int().min(0).max(999999999),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/), draft: propertyDraftSchema,
}).strict()
export type PropertyDraft = z.infer<typeof propertyDraftSchema>
export type PropertyDraftState = { state: 'ready' | 'saved'; revision: number; draft: PropertyDraft | null; baseHash: string | null; requestId?: string }
