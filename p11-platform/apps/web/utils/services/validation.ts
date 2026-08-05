/**
 * Zod Validation Schemas
 *
 * Input validation for all public-facing API endpoints.
 * Prevents malformed data, injection attacks, and unexpected input.
 */

import { z } from 'zod'

// ─── Shared field validators ──────────────────────────────────────────────

const emailField = z.string().email('Invalid email address').max(320, 'Email too long')
const phoneField = z.string().regex(/^[+]?[\d\s().-]{7,20}$/, 'Invalid phone number').max(20)
// Widgets send `phone: ""` when the visitor leaves the optional field blank,
// so optional phone inputs must accept the empty string.
const optionalPhoneField = phoneField.or(z.literal(''))
const uuidField = z.string().uuid('Invalid ID format')
const safeString = (maxLen: number) => z.string().max(maxLen).trim()

// ─── LumaLeasing Chat ────────────────────────────────────────────────────

export const chatMessageSchema = z.object({
  role: z.literal('user'),
  content: safeString(5000),
}).strict()

export const chatRequestSchema = z.object({
  // The public client is only authoritative for its newest user turn.
  // Conversation history is rebuilt from the property-scoped server session.
  messages: z.tuple([chatMessageSchema], {
    error: 'Exactly one user message is required',
  }),
  sessionId: safeString(100).optional().nullable(),
  // leadInfo rides along with chat messages from the widget's client-side
  // contact extraction, which is looser than our validators. A malformed
  // extracted email/phone must never fail the whole chat request (the widget
  // resends it with every message, bricking the conversation) — drop the bad
  // field instead and let the server-side extraction re-derive contact info
  // from the transcript.
  leadInfo: z.object({
    first_name: safeString(100).optional().nullable(),
    last_name: safeString(100).optional().nullable(),
    email: emailField.optional().nullable().catch(null),
    phone: optionalPhoneField.optional().nullable().catch(null),
  }).optional().nullable().catch(null),
}).strict()

// ─── LeadPulse ────────────────────────────────────────────────────────────

export const leadPulseEventRequestSchema = z.object({
  leadId: safeString(100).min(1),
  eventType: safeString(100).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  propertyId: safeString(100).min(1).optional(),
}).strict()

export const leadPulseScoreRequestSchema = z.object({
  leadId: safeString(100).min(1).optional(),
  leadIds: z.array(safeString(100).min(1)).min(1).max(500).optional(),
  propertyId: safeString(100).min(1).optional(),
}).strict().superRefine((data, ctx) => {
  const targets = Number(Boolean(data.leadId)) + Number(Boolean(data.leadIds)) + Number(Boolean(data.propertyId && !data.leadId && !data.leadIds))
  if (targets !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one scoring target',
    })
  }
  if (data.leadIds && new Set(data.leadIds).size !== data.leadIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'leadIds must be unique',
      path: ['leadIds'],
    })
  }
})

// ─── LumaLeasing Tour Booking ─────────────────────────────────────────────

export const tourBookingSchema = z.object({
  slotId: safeString(100).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM').optional(),
  tourDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  tourTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM').optional(),
  leadInfo: z.object({
    firstName: safeString(100).optional().default(''),
    first_name: safeString(100).optional().default(''),
    lastName: safeString(100).optional().default(''),
    last_name: safeString(100).optional().default(''),
    email: emailField,
    phone: optionalPhoneField.optional().default(''),
    moveInDate: safeString(20).optional(),
    bedroomPreference: safeString(20).optional(),
    notes: safeString(1000).optional(),
  }),
  notes: safeString(1000).optional(),
  specialRequests: safeString(1000).optional(),
  sessionId: safeString(100).optional().nullable(),
  conversationId: safeString(100).optional().nullable(),
}).superRefine((data, ctx) => {
  const effectiveDate = data.tourDate || data.date
  const effectiveTime = data.tourTime || data.time

  if (!data.slotId && (!effectiveDate || !effectiveTime)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either slotId or tourDate+tourTime are required',
      path: ['slotId'],
    })
  }
})

// ─── LumaLeasing Lead Capture ─────────────────────────────────────────────

export const leadCaptureSchema = z.object({
  // Support both direct fields and leadInfo wrapper
  leadInfo: z.object({
    first_name: safeString(100).optional(),
    firstName: safeString(100).optional(),
    last_name: safeString(100).optional(),
    lastName: safeString(100).optional(),
    email: emailField.optional(),
    phone: optionalPhoneField.optional(),
    moveInDate: safeString(20).optional(),
    bedroomPreference: safeString(20).optional(),
    notes: safeString(1000).optional(),
  }).optional(),
  first_name: safeString(100).optional(),
  firstName: safeString(100).optional(),
  last_name: safeString(100).optional(),
  lastName: safeString(100).optional(),
  email: emailField.optional(),
  phone: optionalPhoneField.optional(),
  sessionId: safeString(100).optional().nullable(),
  conversationId: safeString(100).optional().nullable(),
}).refine(
  (data) => {
    const info = data.leadInfo || data
    return !!(info.email || info.phone)
  },
  { message: 'Email or phone is required' }
)

// ─── Tour Completion ──────────────────────────────────────────────────────

export const tourCompleteSchema = z.object({
  tourId: uuidField,
  notes: safeString(2000).optional(),
})

// ─── Admin Config Update ──────────────────────────────────────────────────

export const adminConfigUpdateSchema = z.object({
  propertyId: uuidField,
  config: z.object({
    widget_name: safeString(100).optional(),
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
    secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
    logo_url: z.string().url().max(2048).optional().nullable(),
    agent_avatar_url: z.string().url().max(2048).optional().nullable(),
    welcome_message: safeString(500).optional(),
    offline_message: safeString(500).optional(),
    auto_popup_delay_seconds: z.number().int().min(0).max(300).optional(),
    require_email_before_chat: z.boolean().optional(),
    collect_name: z.boolean().optional(),
    collect_email: z.boolean().optional(),
    collect_phone: z.boolean().optional(),
    lead_capture_prompt: safeString(500).optional(),
    floor_plans_url: z.string().url().max(2048).optional().nullable(),
    availability_url: z.string().url().max(2048).optional().nullable(),
    tours_enabled: z.boolean().optional(),
    tour_duration_minutes: z.number().int().min(15).max(180).optional(),
    tour_buffer_minutes: z.number().int().min(0).max(60).optional(),
    business_hours: z.record(z.string(), z.unknown()).optional(),
    timezone: safeString(50).optional(),
    is_active: z.boolean().optional(),
  }),
})

export const apiKeyRegenerateSchema = z.object({
  propertyId: uuidField,
})

// ─── Gmail Pub/Sub Webhook ─────────────────────────────────────────────────

export const gmailWebhookSchema = z.object({
  message: z.object({
    data: safeString(10_000),
    messageId: safeString(255).optional(),
    publishTime: safeString(100).optional(),
  }),
  subscription: safeString(500).optional(),
})

// ─── Workflow Template ────────────────────────────────────────────────────

export const workflowCreateSchema = z.object({
  propertyId: uuidField,
  seedDefaults: z.boolean().optional(),
  name: safeString(100).optional(),
  description: safeString(500).optional().nullable(),
  trigger_on: z.enum(['lead_created', 'tour_no_show', 'tour_completed']).optional(),
  steps: z.array(z.object({
    id: z.number().int().min(0),
    delay_hours: z.number().min(0).max(720),
    action: z.enum(['sms', 'email']),
    template_slug: safeString(100),
  })).optional(),
  exit_conditions: z.array(safeString(50)).optional(),
  is_active: z.boolean().optional(),
})

// ─── Generic helpers ──────────────────────────────────────────────────────

/**
 * Validate request body against a Zod schema.
 * Returns { success: true, data } or { success: false, error: string }.
 */
export function validateBody<T>(
  body: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body)
  if (result.success) {
    return { success: true, data: result.data }
  }

  // Build a human-readable error from Zod issues
  const messages = result.error.issues.map(issue => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })

  return { success: false, error: messages.join('; ') }
}
