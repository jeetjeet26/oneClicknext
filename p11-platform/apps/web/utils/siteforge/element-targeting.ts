import { z } from 'zod'

const identitySchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const siteForgeTargetKindSchema = z.enum([
  'page',
  'section',
  'header',
  'footer',
  'menu',
  'menu_item',
  'headline',
  'image',
  'cta',
  'repeater_item',
  'form_control',
  'pseudo',
])

export const siteForgeResourcePathSegmentSchema = z
  .object({
    kind: siteForgeTargetKindSchema.exclude(['pseudo']),
    id: identitySchema,
  })
  .strict()

export const siteForgeResourcePathSchema = z
  .array(siteForgeResourcePathSegmentSchema)
  .min(1)
  .max(16)
  .superRefine((segments, context) => {
    const seen = new Set<string>()
    for (const [index, segment] of segments.entries()) {
      const key = `${segment.kind}:${segment.id}`
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'Resource paths cannot repeat an identity',
        })
      }
      seen.add(key)
    }
  })

export const siteForgeBoundingBoxSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    top: z.number().finite(),
    right: z.number().finite(),
    bottom: z.number().finite(),
    left: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict()

const selectorSchema = z
  .string()
  .min(1)
  .max(600)
  .regex(
    /^\[data-siteforge-target-id="[A-Za-z0-9._:@/-]+"\](?:::(?:before|after))?$/,
    'Selectors must address one exact SiteForge target'
  )

export const siteForgeElementTargetSchema = z
  .object({
    targetId: z
      .string()
      .min(1)
      .max(600)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*(?:::(?:before|after))?$/),
    kind: siteForgeTargetKindSchema,
    resourcePath: siteForgeResourcePathSchema,
    selector: selectorSchema,
    displayValue: z.string().max(2_000),
    boundingBox: siteForgeBoundingBoxSchema,
    pseudo: z.enum(['before', 'after']).nullable(),
  })
  .strict()
  .superRefine((target, context) => {
    const pseudoSuffix = target.pseudo ? `::${target.pseudo}` : ''
    const hostId = target.targetId.replace(/::(?:before|after)$/, '')
    if (
      target.selector !==
      `[data-siteforge-target-id="${hostId}"]${pseudoSuffix}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selector'],
        message: 'Selector does not match the exact target identity',
      })
    }
    if ((target.kind === 'pseudo') !== (target.pseudo !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['pseudo'],
        message: 'Only pseudo targets carry a pseudo side',
      })
    }
  })

export const siteForgeEditorSetSelectionModeMessageSchema = z
  .object({
    type: z.literal('siteforge-editor:set-selection-mode'),
    enabled: z.boolean(),
  })
  .strict()

export const siteForgeEditorReadyMessageSchema = z
  .object({
    type: z.literal('siteforge-editor:ready'),
    pageSlug: z.string().min(1).max(160),
  })
  .strict()

export const siteForgeEditorTargetSelectedMessageSchema = z
  .object({
    type: z.literal('siteforge-editor:target-selected'),
    pageSlug: z.string().min(1).max(160),
    target: siteForgeElementTargetSchema,
    virtualTargets: z.array(siteForgeElementTargetSchema).max(2),
  })
  .strict()

export const siteForgeEditorPostMessageSchema = z.discriminatedUnion('type', [
  siteForgeEditorSetSelectionModeMessageSchema,
  siteForgeEditorReadyMessageSchema,
  siteForgeEditorTargetSelectedMessageSchema,
])

export type SiteForgeElementTarget = z.infer<
  typeof siteForgeElementTargetSchema
>
export type SiteForgeEditorPostMessage = z.infer<
  typeof siteForgeEditorPostMessageSchema
>

export function siteForgeTargetId(
  path: z.input<typeof siteForgeResourcePathSchema>
): string {
  const parsed = siteForgeResourcePathSchema.parse(path)
  return parsed.map(segment => `${segment.kind}:${segment.id}`).join('/')
}

export function siteForgeTargetSelector(
  targetId: string,
  pseudo: 'before' | 'after' | null = null
): string {
  const hostId = targetId.replace(/::(?:before|after)$/, '')
  const selector = `[data-siteforge-target-id="${hostId}"]${
    pseudo ? `::${pseudo}` : ''
  }`
  return selectorSchema.parse(selector)
}

export function parseSiteForgeEditorPostMessage(
  value: unknown
): SiteForgeEditorPostMessage {
  return siteForgeEditorPostMessageSchema.parse(value)
}
