import { anthropic } from '@ai-sdk/anthropic'
import { ToolLoopAgent, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import {
  blueprintPatchOperationsSchema,
  type BlueprintPatchOperation,
} from '@/types/siteforge'
import { SITEFORGE_CLAUDE_MODEL } from '@/utils/siteforge/models'
import type { SiteForgeEditorSnapshot } from '@/utils/siteforge/editor/context'

export const runtimeExtensionRequestSchema = z.object({
  capability: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(2_000),
  requestedBehavior: z.string().trim().min(1).max(4_000),
})

export type RuntimeExtensionRequest = z.infer<
  typeof runtimeExtensionRequestSchema
>

export interface SiteForgeEditorAgentResult {
  response: string
  operations: BlueprintPatchOperation[]
  extensionRequest: RuntimeExtensionRequest | null
  clarification: string | null
  toolSummary: Array<{ tool: string; detail: string }>
}

function compactSnapshot(snapshot: SiteForgeEditorSnapshot) {
  return {
    artifact: snapshot.artifact,
    propertyEvidence: snapshot.propertyEvidence,
    approvedAssets: snapshot.approvedAssets,
    revisionHistory: snapshot.revisionHistory,
    wordpressCapabilities: snapshot.wordpressCapabilities,
    renderedEvidence: snapshot.renderedEvidence,
  }
}

export async function runSiteForgeEditorAgent(input: {
  snapshot: SiteForgeEditorSnapshot
  userIntent: string
  model?: string
}): Promise<SiteForgeEditorAgentResult> {
  const proposedOperations: BlueprintPatchOperation[] = []
  let extensionRequest: RuntimeExtensionRequest | null = null
  let clarification: string | null = null
  const toolSummary: Array<{ tool: string; detail: string }> = []

  const tools = {
    inspectSite: tool({
      description:
        'Inspect the complete current immutable blueprint, configuration, evidence, and revision history.',
      inputSchema: z.object({}),
      execute: async () => {
        toolSummary.push({
          tool: 'inspectSite',
          detail: 'Loaded immutable site snapshot',
        })
        return compactSnapshot(input.snapshot)
      },
    }),
    inspectRenderedPage: tool({
      description:
        'Inspect current rendered HTML, accessibility data, and screenshots for a page.',
      inputSchema: z.object({ pageSlug: z.string().min(1).optional() }),
      execute: async ({ pageSlug }) => {
        toolSummary.push({
          tool: 'inspectRenderedPage',
          detail: `Inspected ${pageSlug || 'current page'} render evidence`,
        })
        return {
          pageSlug: pageSlug || null,
          evidence: input.snapshot.renderedEvidence,
        }
      },
    }),
    searchAssets: tool({
      description: 'Search the tenant-approved asset library for usable media.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
      execute: async ({ query }) => {
        const assets = Array.isArray(input.snapshot.approvedAssets)
          ? input.snapshot.approvedAssets
          : []
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
        const matches = assets.filter((asset) => {
          const haystack = JSON.stringify(asset).toLowerCase()
          return terms.every((term) => haystack.includes(term))
        })
        toolSummary.push({
          tool: 'searchAssets',
          detail: `Found ${matches.length} approved asset matches`,
        })
        return matches.slice(0, 20)
      },
    }),
    applySemanticOperations: tool({
      description:
        'Submit the complete versioned semantic operation set for deterministic validation and later publication.',
      inputSchema: z.object({
        operations: blueprintPatchOperationsSchema,
      }),
      execute: async ({ operations }) => {
        proposedOperations.splice(0, proposedOperations.length, ...operations)
        toolSummary.push({
          tool: 'applySemanticOperations',
          detail: `Validated ${operations.length} semantic operations`,
        })
        return { accepted: true, operationCount: operations.length }
      },
    }),
    requestCapabilityExtension: tool({
      description:
        'Request a separately reviewed runtime capability when semantic operations cannot safely express the request. This never executes code or changes WordPress.',
      inputSchema: runtimeExtensionRequestSchema,
      execute: async (request) => {
        extensionRequest = request
        toolSummary.push({
          tool: 'requestCapabilityExtension',
          detail: `Requested reviewed capability ${request.capability}`,
        })
        return {
          approvalRequired: true,
          capability: request.capability,
        }
      },
    }),
    requestClarification: tool({
      description:
        'Ask one focused question when the requested edit is ambiguous or unsupported.',
      inputSchema: z.object({ question: z.string().trim().min(1).max(1_000) }),
      execute: async ({ question }) => {
        clarification = question
        toolSummary.push({ tool: 'requestClarification', detail: question })
        return { awaitingUser: true }
      },
    }),
  }
  const prompt = [
    `User request: ${input.userIntent}`,
    `Current immutable snapshot: ${JSON.stringify(compactSnapshot(input.snapshot))}`,
  ].join('\n\n')
  const instructions = [
    'You are the SiteForge semantic site editor.',
    'Edit the complete immutable website contract, not an isolated ACF field.',
    'Use semantic operations first. Call applySemanticOperations exactly once with the complete validated operation set.',
    'When the request cannot be represented by semantic operations, call requestCapabilityExtension. Never generate or execute PHP, JavaScript, CSS, or theme overlays in the normal editor.',
    'Never invent property facts, pricing, availability, concessions, accessibility claims, testimonials, or asset URLs.',
    'Use only approved assets returned by searchAssets.',
    'For logo or favicon changes, include the returned immutable asset ID and URL together in media.update.',
    'Never request or expose credentials and never attempt direct database, filesystem, WordPress, Cloudways, or network writes.',
    'If evidence or intent is materially ambiguous, call requestClarification and do not apply changes.',
    'Keep the final response concise and explain what changed.',
  ].join('\n')
  const generate = (model: string | ReturnType<typeof anthropic>) =>
    new ToolLoopAgent({
      model,
      stopWhen: stepCountIs(10),
      instructions,
      tools,
    }).generate({ prompt })

  const result = await generate(
    input.model || anthropic(SITEFORGE_CLAUDE_MODEL)
  )

  if (
    !clarification &&
    proposedOperations.length === 0 &&
    !extensionRequest
  ) {
    throw new Error('Editor agent completed without a validated edit proposal')
  }

  return {
    response: result.text || clarification || 'The edit proposal is ready.',
    operations: proposedOperations,
    extensionRequest,
    clarification,
    toolSummary,
  }
}
