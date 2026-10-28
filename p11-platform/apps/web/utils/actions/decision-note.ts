import { z } from 'zod'

/** Compatibility value for retained history that requires nonempty text.
 * This records the absence of a user note; it is not a user justification.
 */
export const NO_DECISION_NOTE = 'No additional note.'
export function decisionNote(max = 2000, min = 3) {
  return z.string().trim().max(max)
    .refine(value => !value.includes('\u0000'), 'Notes cannot contain null characters.')
    .refine(value => !value || value.length >= min, `Use at least ${min} characters for a note, or leave it blank.`)
    .optional().transform(value => value || NO_DECISION_NOTE)
}
export function hasDecisionNote(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.trim() !== NO_DECISION_NOTE
}
/** Apply only to decisions where another person needs the explanation. */
export function requireDecisionNote(value: { reason?: string }, ctx: z.RefinementCtx) {
  if (!hasDecisionNote(value.reason)) ctx.addIssue({code: 'custom', path: ['reason'], message: 'Explain this rejection or exception before continuing.'})
}

/** For compact history rows that render notes inline rather than as paragraphs. */
export function decisionNoteText(value: unknown): string {
  return hasDecisionNote(value) ? value : ''
}
