import type { SectionPresentation } from '@/types/siteforge'

// Deterministic presentation recipes: canonical intent-to-fields mappings for
// common visual edit requests. The same request must produce the same
// presentation field set regardless of model or session — e.g. "left-align
// the container" is always alignment + containerMode + width preset together,
// never a partial combination that bleeds text to the viewport edge. The
// agent free-forms presentation fields only when no recipe matches.

type RecipePresentation = Partial<
  Pick<
    SectionPresentation,
    | 'containerMode'
    | 'alignment'
    | 'widthPreset'
    | 'spacingPreset'
    | 'typographyPreset'
    | 'motionPreset'
  >
>

export type SiteForgePresentationRecipe = {
  id: string
  description: string
  match: RegExp
  presentation: RecipePresentation
}

export const SITEFORGE_PRESENTATION_RECIPES: readonly SiteForgePresentationRecipe[] =
  [
    {
      id: 'container-align-left',
      description:
        'Left-align the section container inside the standard page margin',
      match:
        /\bleft[-\s]?align\w*\b|\balign\w*[^.\n]{0,40}\bleft\b|\b(?:move|shift)\w*[^.\n]{0,40}\b(?:over\s+)?(?:to\s+the\s+)?left\b/i,
      presentation: {
        alignment: 'left',
        containerMode: 'contained',
        widthPreset: 'content',
      },
    },
    {
      id: 'container-align-right',
      description:
        'Right-align the section container inside the standard page margin',
      match:
        /\bright[-\s]?align\w*\b|\balign\w*[^.\n]{0,40}\bright\b|\b(?:move|shift)\w*[^.\n]{0,40}\b(?:over\s+)?(?:to\s+the\s+)?right\b/i,
      presentation: {
        alignment: 'right',
        containerMode: 'contained',
        widthPreset: 'content',
      },
    },
    {
      id: 'container-align-center',
      description: 'Center the section container',
      match:
        /\bcenter[-\s]?align\w*\b|\b(?:center|centre)\w*[^.\n]{0,40}\b(?:container|text|content|column|section|headline|it)\b|\brecenter\b/i,
      presentation: {
        alignment: 'center',
        containerMode: 'contained',
        widthPreset: 'content',
      },
    },
    {
      id: 'container-full-bleed',
      description: 'Bleed the section to the raw viewport edges',
      match: /\bfull[-\s]?bleed\b|\bbleed\w*[^.\n]{0,30}\bedge/i,
      presentation: {
        containerMode: 'full-bleed',
        widthPreset: 'full',
        alignment: 'stretch',
      },
    },
    {
      id: 'container-full-width',
      description: 'Span the full page width',
      match:
        /\bfull[-\s]?width\b|\bedge[-\s]?to[-\s]?edge\b|\bspan\w*[^.\n]{0,30}\b(?:full|whole|entire)\s+(?:page|screen|width)\b/i,
      presentation: {
        containerMode: 'full-width',
        widthPreset: 'full',
        alignment: 'stretch',
      },
    },
    {
      id: 'width-narrow',
      description: 'Narrow the content column',
      match:
        /\bnarrow(?:er)?\b|\bless\s+wide\b|\bslimmer\s+(?:column|container)\b/i,
      presentation: { widthPreset: 'narrow', containerMode: 'contained' },
    },
    {
      id: 'width-wide',
      description: 'Widen the content column',
      match: /\bwider\b|\bmore\s+width\b|\bbroader\s+(?:column|container)\b/i,
      presentation: { widthPreset: 'wide' },
    },
    {
      id: 'spacing-spacious',
      description: 'Add breathing room around the section',
      match:
        /\bmore\s+(?:breathing\s+room|space|spacing|padding|whitespace)\b|\bairier\b|\b(?:more\s+)?spacious\b/i,
      presentation: { spacingPreset: 'spacious' },
    },
    {
      id: 'spacing-compact',
      description: 'Tighten the spacing around the section',
      match:
        /\bless\s+(?:space|spacing|padding|whitespace)\b|\btighten\w*[^.\n]{0,30}\bspacing\b|\bmore\s+compact\b|\bcompact\s+spacing\b/i,
      presentation: { spacingPreset: 'compact' },
    },
    {
      id: 'spacing-none',
      description: 'Remove the spacing around the section',
      match:
        /\b(?:no|remove|zero)\s+(?:the\s+)?(?:space|spacing|padding|gap)\b/i,
      presentation: { spacingPreset: 'none' },
    },
    {
      id: 'motion-none',
      description: 'Disable motion and animation',
      match:
        /\b(?:no|remove|disable|stop|kill)\s+(?:the\s+)?(?:motion|animations?|parallax)\b|\breduce\s+motion\b/i,
      presentation: { motionPreset: 'none' },
    },
    {
      id: 'motion-subtle',
      description: 'Tone motion down to subtle',
      match:
        /\bsubtle\s+(?:motion|animations?)\b|\btone\s+down\s+(?:the\s+)?(?:motion|animations?)\b/i,
      presentation: { motionPreset: 'subtle' },
    },
    {
      id: 'motion-expressive',
      description: 'Make motion more expressive',
      match:
        /\bmore\s+(?:motion|animation|movement)\b|\bexpressive\s+motion\b|\banimate\s+more\b/i,
      presentation: { motionPreset: 'expressive' },
    },
  ]

export type ResolvedPresentationRecipe = {
  recipeIds: string[]
  descriptions: string[]
  presentation: RecipePresentation
}

// First matching recipe wins each field; recipes are ordered from most to
// least specific so combined requests ("left aligned and full width") merge
// deterministically.
export function resolveSiteForgePresentationRecipe(
  userIntent: string
): ResolvedPresentationRecipe | null {
  const matched = SITEFORGE_PRESENTATION_RECIPES.filter(recipe =>
    recipe.match.test(userIntent)
  )
  if (matched.length === 0) return null
  const presentation: RecipePresentation = {}
  for (const recipe of matched) {
    for (const [field, value] of Object.entries(recipe.presentation)) {
      if (!(field in presentation)) {
        ;(presentation as Record<string, unknown>)[field] = value
      }
    }
  }
  return {
    recipeIds: matched.map(recipe => recipe.id),
    descriptions: matched.map(recipe => recipe.description),
    presentation,
  }
}

type SemanticOperation = Record<string, unknown> & { op: string }

// Deterministically enforce the canonical field set on the agent's proposed
// operations: every section.update that touches presentation (or targets the
// operator-selected section) receives the recipe's exact fields, so partial
// combinations cannot ship.
export function applyPresentationRecipeToOperations<
  T extends SemanticOperation,
>(
  operations: T[],
  recipe: ResolvedPresentationRecipe,
  elementContext?: { sectionId: string }
): T[] {
  return operations.map(operation => {
    if (operation.op !== 'section.update') return operation
    const value = operation.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return operation
    }
    const valueRecord = value as Record<string, unknown>
    const hasPresentation =
      valueRecord.presentation &&
      typeof valueRecord.presentation === 'object' &&
      !Array.isArray(valueRecord.presentation)
    const targetsSelectedSection =
      elementContext && operation.sectionId === elementContext.sectionId
    if (!hasPresentation && !targetsSelectedSection) return operation
    return {
      ...operation,
      value: {
        ...valueRecord,
        presentation: {
          ...(hasPresentation
            ? (valueRecord.presentation as Record<string, unknown>)
            : {}),
          ...recipe.presentation,
        },
      },
    }
  })
}
