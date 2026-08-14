import { generateText, Output } from 'ai'
import type { LanguageModel } from 'ai'
import { SITEFORGE_EDITOR_MODEL } from '@/utils/siteforge/models'
import {
  siteForgeDirectionEditOutcomeSchema,
  type SiteForgeCreativeDirection,
  type SiteForgeDirectionEditOutcome,
} from './contracts'

export type SiteForgeDirectionEditorAgentInput = {
  instruction: string
  direction: SiteForgeCreativeDirection
  approvedPalette: string[]
  approvedFonts: string[]
  model?: LanguageModel | string
}

export async function runSiteForgeDirectionEditorAgent(
  input: SiteForgeDirectionEditorAgentInput
): Promise<{
  outcome: SiteForgeDirectionEditOutcome
  model: string
  toolSummary: string
}> {
  const model = input.model || SITEFORGE_EDITOR_MODEL
  const result = await generateText({
    model,
    output: Output.object({ schema: siteForgeDirectionEditOutcomeSchema }),
    system: [
      'You are the SiteForge creative-direction editor.',
      'Return one structured outcome: patch, clarification, or rejection.',
      'Use clarification when the requested change is ambiguous.',
      'Reject requests that alter property facts, provenance, source identities, or require unapproved brand assets.',
      'A patch may only contain editable creative fields from the supplied schema.',
      `Palette values must be chosen only from: ${input.approvedPalette.join(', ')}.`,
      `Font families must be chosen only from: ${input.approvedFonts.join(', ')}.`,
      'Never invent colors, fonts, property facts, claims, identifiers, or hashes.',
    ].join('\n'),
    prompt: JSON.stringify({
      instruction: input.instruction,
      currentDirection: input.direction,
    }),
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(60_000),
  })
  if (!result.output) {
    throw new Error('The direction editor did not return a structured outcome')
  }
  return {
    outcome: result.output,
    model: typeof model === 'string' ? model : 'injected-language-model',
    toolSummary:
      result.output.outcome === 'patch'
        ? `direction.patch:${Object.keys(result.output.patch).sort().join(',')}`
        : `direction.${result.output.outcome}`,
  }
}
