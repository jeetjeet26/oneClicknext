import { z } from 'zod'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export const governedPrimitiveSchema = z.enum([
  'section',
  'container',
  'grid',
  'stack',
  'text',
  'image',
  'button',
  'list',
  'form',
  'tabs',
  'accordion',
  'modal',
  'carousel',
])

const componentIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
const semverSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
  )
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const safeClassSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9-]*$/)

export interface GovernedField {
  fieldId: string
  label: string
  type:
    | 'string'
    | 'rich_text'
    | 'url'
    | 'boolean'
    | 'number'
    | 'enum'
    | 'image_asset'
    | 'object'
    | 'list'
  required: boolean
  defaultValue?: unknown
  enumValues?: string[]
  itemFields?: GovernedField[]
}

export const governedFieldSchema: z.ZodType<GovernedField> = z.lazy(() =>
  z.object({
    fieldId: componentIdSchema,
    label: z.string().min(1).max(200),
    type: z.enum([
      'string',
      'rich_text',
      'url',
      'boolean',
      'number',
      'enum',
      'image_asset',
      'object',
      'list',
    ]),
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    enumValues: z.array(z.string().min(1).max(200)).max(100).optional(),
    itemFields: z.array(governedFieldSchema).max(50).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if ((field.type === 'enum') !== Boolean(field.enumValues?.length)) {
      context.addIssue({
        code: 'custom',
        path: ['enumValues'],
        message: 'Enum fields alone require enumValues',
      })
    }
    if ((field.type === 'object' || field.type === 'list') !== Boolean(field.itemFields?.length)) {
      context.addIssue({
        code: 'custom',
        path: ['itemFields'],
        message: 'Object and list fields require typed itemFields',
      })
    }
    if (field.required && field.defaultValue === null) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Required fields cannot default to null',
      })
    }
  })
)

const governedValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z
    .object({
      field: componentIdSchema,
    })
    .strict(),
])

const governedAccessibilitySchema = z
  .object({
    role: z.string().max(100).nullable(),
    name: governedValueSchema.nullable(),
    description: governedValueSchema.nullable(),
    keyboard: z
      .array(z.enum(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowKeys']))
      .max(12),
    focusPolicy: z.enum(['none', 'natural', 'roving', 'trap']),
    liveRegion: z.enum(['off', 'polite', 'assertive']),
  })
  .strict()

export const governedNodeSchema: z.ZodType<GovernedNode> = z.lazy(() =>
  z
    .object({
      nodeId: componentIdSchema,
      primitive: governedPrimitiveSchema,
      classes: z.array(safeClassSchema).max(20),
      properties: z.record(z.string(), governedValueSchema),
      accessibility: governedAccessibilitySchema,
      children: z.array(governedNodeSchema).max(100),
    })
    .strict()
)

export interface GovernedNode {
  nodeId: string
  primitive: z.infer<typeof governedPrimitiveSchema>
  classes: string[]
  properties: Record<string, z.infer<typeof governedValueSchema>>
  accessibility: z.infer<typeof governedAccessibilitySchema>
  children: GovernedNode[]
}

const safeResponsiveProperties = new Set([
  'display',
  'grid-template-columns',
  'gap',
  'align-items',
  'justify-content',
  'padding',
  'margin',
  'max-width',
  'font-size',
  'text-align',
  'aspect-ratio',
  'object-fit',
])

export const governedResponsiveRuleSchema = z
  .object({
    ruleId: componentIdSchema,
    nodeId: componentIdSchema,
    minWidthPx: z.number().int().nonnegative().nullable(),
    maxWidthPx: z.number().int().positive().nullable(),
    declarations: z.record(
      z.string(),
      z.string().min(1).max(200).refine(value => !/[{};<>]/.test(value))
    ),
  })
  .strict()
  .superRefine((rule, context) => {
    for (const property of Object.keys(rule.declarations)) {
      if (!safeResponsiveProperties.has(property)) {
        context.addIssue({
          code: 'custom',
          path: ['declarations', property],
          message: `Responsive property ${property} is not allowlisted`,
        })
      }
    }
  })
  .refine(
    rule =>
      rule.minWidthPx === null ||
      rule.maxWidthPx === null ||
      rule.minWidthPx <= rule.maxWidthPx,
    'Responsive minimum cannot exceed maximum'
  )

export const governedCertificationScenarioSchema = z
  .object({
    scenarioId: componentIdSchema,
    viewport: z
      .object({
        width: z.number().int().min(320).max(7680),
        height: z.number().int().min(320).max(4320),
      })
      .strict(),
    colorScheme: z.enum(['light', 'dark']),
    reducedMotion: z.boolean(),
    interactions: z
      .array(
        z
          .object({
            action: z.enum(['focus', 'click', 'press']),
            nodeId: componentIdSchema,
            key: z
              .enum(['Enter', 'Space', 'Escape', 'ArrowLeft', 'ArrowRight'])
              .nullable(),
          })
          .strict()
      )
      .max(100),
    assertions: z
      .array(
        z
          .object({
            rule: z.enum([
              'axe',
              'keyboard_reachable',
              'focus_visible',
              'no_overflow',
              'reduced_motion',
              'selection_map_exact',
              'visual_snapshot',
            ]),
            nodeId: componentIdSchema.nullable(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict()

export const governedComponentSchema = z
  .object({
    schemaVersion: z.literal(1),
    componentId: componentIdSchema,
    version: semverSchema,
    displayName: z.string().min(1).max(200),
    fields: z.array(governedFieldSchema).max(100),
    root: governedNodeSchema,
    responsiveRules: z.array(governedResponsiveRuleSchema).max(200),
    accessibilityContract: z
      .object({
        standard: z.literal('WCAG-2.2-AA'),
        headingPolicy: z.enum(['inherits', 'section-heading', 'no-heading']),
        landmarkPolicy: z.enum(['required', 'optional', 'forbidden']),
        requiresVisibleFocus: z.literal(true),
        supportsReducedMotion: z.literal(true),
      })
      .strict(),
    certificationScenarios: z
      .array(governedCertificationScenarioSchema)
      .min(2)
      .max(50),
  })
  .strict()
  .superRefine(addComponentIssues)

export const governedComponentPackageSchema = z
  .object({
    format: z.literal('siteforge-governed-component-package-v1'),
    componentId: componentIdSchema,
    componentVersion: semverSchema,
    compilerVersion: semverSchema,
    descriptorSha256: sha256Schema,
    packageSha256: sha256Schema,
    files: z
      .array(
        z
          .object({
            path: z.literal('component.json'),
            mediaType: z.literal('application/json'),
            byteSha256: sha256Schema,
          })
          .strict()
      )
      .length(1),
  })
  .strict()

export interface CompiledGovernedComponent {
  compilerVersion: string
  componentId: string
  componentVersion: string
  descriptorHash: string
  renderPlan: GovernedNode
  responsiveRules: z.infer<typeof governedResponsiveRuleSchema>[]
  selectionMap: Record<
    string,
    {
      nodeId: string
      primitive: z.infer<typeof governedPrimitiveSchema>
      resourcePath: string
      selector: string
    }
  >
  accessibilityContract: z.infer<
    typeof governedComponentSchema.shape.accessibilityContract
  >
  certificationScenarios: z.infer<
    typeof governedCertificationScenarioSchema
  >[]
  catalogs: {
    v2: { blockName: 'acf/governed-component'; componentKey: string }
    v3: {
      blockName: 'acf/governed-component'
      componentKey: string
      descriptorHash: string
    }
  }
}

export function compileGovernedComponent(
  input: z.input<typeof governedComponentSchema>,
  compilerVersion = '1.0.0'
): Readonly<CompiledGovernedComponent> {
  const component = governedComponentSchema.parse(input)
  const parsedCompilerVersion = semverSchema.parse(compilerVersion)
  const componentKey = `${component.componentId}@${component.version}`
  const descriptorHash = hashSiteForgeContent(component)
  const selectionMap: CompiledGovernedComponent['selectionMap'] = {}

  walk(component.root, [], node => {
    const targetId = `component:${componentKey}/node:${node.nodeId}`
    selectionMap[node.nodeId] = {
      nodeId: node.nodeId,
      primitive: node.primitive,
      resourcePath: targetId,
      selector: `[data-siteforge-target-id="${targetId}"]`,
    }
  })

  return freeze({
    compilerVersion: parsedCompilerVersion,
    componentId: component.componentId,
    componentVersion: component.version,
    descriptorHash,
    renderPlan: component.root,
    responsiveRules: [...component.responsiveRules].sort((a, b) =>
      a.ruleId.localeCompare(b.ruleId)
    ),
    selectionMap: Object.fromEntries(
      Object.entries(selectionMap).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    accessibilityContract: component.accessibilityContract,
    certificationScenarios: component.certificationScenarios,
    catalogs: {
      v2: { blockName: 'acf/governed-component', componentKey },
      v3: {
        blockName: 'acf/governed-component',
        componentKey,
        descriptorHash,
      },
    },
  })
}

export function registerGovernedComponentPackage(input: {
  compiled: CompiledGovernedComponent
  package: z.input<typeof governedComponentPackageSchema>
}): Readonly<{
  v2: CompiledGovernedComponent['catalogs']['v2']
  v3: CompiledGovernedComponent['catalogs']['v3'] & { packageSha256: string }
}> {
  const packageDescriptor = governedComponentPackageSchema.parse(input.package)
  const componentKey = `${input.compiled.componentId}@${input.compiled.componentVersion}`
  if (
    packageDescriptor.componentId !== input.compiled.componentId ||
    packageDescriptor.componentVersion !== input.compiled.componentVersion ||
    packageDescriptor.compilerVersion !== input.compiled.compilerVersion ||
    packageDescriptor.descriptorSha256 !== input.compiled.descriptorHash ||
    packageDescriptor.files[0]?.byteSha256 !== input.compiled.descriptorHash ||
    input.compiled.catalogs.v2.componentKey !== componentKey ||
    input.compiled.catalogs.v3.componentKey !== componentKey
  ) {
    throw new Error(
      'Governed component package does not match the exact compiled descriptor'
    )
  }
  return freeze({
    v2: input.compiled.catalogs.v2,
    v3: {
      ...input.compiled.catalogs.v3,
      packageSha256: packageDescriptor.packageSha256,
    },
  })
}

function addComponentIssues(
  component: z.infer<typeof governedComponentSchema>,
  context: z.RefinementCtx
): void {
  const fields = new Set<string>()
  for (const [index, field] of component.fields.entries()) {
    if (fields.has(field.fieldId)) {
      context.addIssue({
        code: 'custom',
        path: ['fields', index, 'fieldId'],
        message: 'Field identities must be unique',
      })
    }
    fields.add(field.fieldId)
  }

  const nodes = new Map<string, GovernedNode>()
  walk(component.root, [], (node, path) => {
    if (nodes.has(node.nodeId)) {
      context.addIssue({
        code: 'custom',
        path: ['root', ...path, 'nodeId'],
        message: 'Node identities must be unique',
      })
    }
    nodes.set(node.nodeId, node)
    for (const [property, value] of Object.entries(node.properties)) {
      if (
        value &&
        typeof value === 'object' &&
        'field' in value &&
        !fields.has(value.field)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['root', ...path, 'properties', property],
          message: `Property references unknown field ${value.field}`,
        })
      }
    }
  })

  for (const [index, rule] of component.responsiveRules.entries()) {
    if (!nodes.has(rule.nodeId)) {
      context.addIssue({
        code: 'custom',
        path: ['responsiveRules', index, 'nodeId'],
        message: 'Responsive rule targets an unknown node',
      })
    }
  }
  for (const [scenarioIndex, scenario] of component.certificationScenarios.entries()) {
    for (const [interactionIndex, interaction] of scenario.interactions.entries()) {
      if (!nodes.has(interaction.nodeId)) {
        context.addIssue({
          code: 'custom',
          path: [
            'certificationScenarios',
            scenarioIndex,
            'interactions',
            interactionIndex,
            'nodeId',
          ],
          message: 'Certification interaction targets an unknown node',
        })
      }
    }
  }
}

function walk(
  node: GovernedNode,
  path: Array<string | number>,
  visit: (node: GovernedNode, path: Array<string | number>) => void
): void {
  visit(node, path)
  node.children.forEach((child, index) =>
    walk(child, [...path, 'children', index], visit)
  )
}

function freeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    freeze(child)
  }
  return Object.freeze(value)
}
