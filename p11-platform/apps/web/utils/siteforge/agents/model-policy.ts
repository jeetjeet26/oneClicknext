import {
  SITEFORGE_EDITOR_MODEL,
  SITEFORGE_SEMANTIC_EDITOR_MODELS,
} from '@/utils/siteforge/models'
import type { SiteForgeAutonomousRole } from '@/utils/siteforge/autonomy/artifact-envelope'

export const SITEFORGE_AUTONOMY_MODEL_POLICY_VERSION =
  'siteforge.autonomy-model-policy.v1' as const

export type SiteForgeAutonomyBudget = {
  maxInputTokens: number
  maxOutputTokens: number
  maxCostUsd: number
  maxLatencyMs: number
  maxAttempts: number
}

export type SiteForgeRoleModelPolicy = {
  policyVersion: typeof SITEFORGE_AUTONOMY_MODEL_POLICY_VERSION
  role: SiteForgeAutonomousRole
  modelId: string
  provider: string
  settings: {
    maxOutputTokens: number
    temperature: number
  }
  budget: SiteForgeAutonomyBudget
}

type PolicyClass = 'reasoning' | 'creative' | 'verification' | 'operational'

const POLICY_CLASS_BY_ROLE: Record<SiteForgeAutonomousRole, PolicyClass> = {
  'truth-curator.v1': 'verification',
  'strategist.v1': 'reasoning',
  'creative-director.v1': 'creative',
  'design-system.v1': 'creative',
  'content.v1': 'creative',
  'asset-director.v1': 'reasoning',
  'qa-council.v1': 'verification',
  'repair-controller.v1': 'reasoning',
  'release-operator.v1': 'operational',
  'operations.v1': 'operational',
}

const BUDGETS = {
  reasoning: {
    maxInputTokens: 60_000,
    maxOutputTokens: 20_000,
    maxCostUsd: 5,
    maxLatencyMs: 120_000,
    maxAttempts: 3,
  },
  creative: {
    maxInputTokens: 60_000,
    maxOutputTokens: 30_000,
    maxCostUsd: 8,
    maxLatencyMs: 180_000,
    maxAttempts: 3,
  },
  verification: {
    maxInputTokens: 50_000,
    maxOutputTokens: 12_000,
    maxCostUsd: 4,
    maxLatencyMs: 120_000,
    maxAttempts: 2,
  },
  operational: {
    maxInputTokens: 30_000,
    maxOutputTokens: 8_000,
    maxCostUsd: 2,
    maxLatencyMs: 90_000,
    maxAttempts: 2,
  },
} as const satisfies Record<PolicyClass, SiteForgeAutonomyBudget>

const MODEL_BY_POLICY_CLASS: Record<PolicyClass, string> = {
  reasoning: SITEFORGE_SEMANTIC_EDITOR_MODELS.structural,
  creative: SITEFORGE_EDITOR_MODEL,
  verification: SITEFORGE_SEMANTIC_EDITOR_MODELS.targeted,
  operational: SITEFORGE_SEMANTIC_EDITOR_MODELS.targeted,
}

const TEMPERATURE_BY_POLICY_CLASS: Record<PolicyClass, number> = {
  reasoning: 0.2,
  creative: 0.7,
  verification: 0,
  operational: 0,
}

/**
 * Current SiteForge constants include both Anthropic-native IDs and
 * Gateway-qualified IDs. New autonomous calls always consume the AI SDK
 * Gateway form (`provider/model`).
 */
export function siteForgeGatewayModelId(modelId: string): string {
  const normalized = modelId.trim()
  if (!normalized) throw new Error('SiteForge model ID cannot be empty')
  const gatewayId = normalized.includes('/')
    ? normalized
    : `anthropic/${normalized}`
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(gatewayId)) {
    throw new Error(`Invalid SiteForge Gateway model ID: ${modelId}`)
  }
  return gatewayId
}

export function resolveSiteForgeRoleModelPolicy(
  role: SiteForgeAutonomousRole
): SiteForgeRoleModelPolicy {
  const policyClass = POLICY_CLASS_BY_ROLE[role]
  if (!policyClass) {
    throw new Error(`No SiteForge model policy is registered for role ${role}`)
  }
  const modelId = siteForgeGatewayModelId(MODEL_BY_POLICY_CLASS[policyClass])
  const budget = { ...BUDGETS[policyClass] }
  return {
    policyVersion: SITEFORGE_AUTONOMY_MODEL_POLICY_VERSION,
    role,
    modelId,
    provider: modelId.slice(0, modelId.indexOf('/')),
    settings: {
      maxOutputTokens: budget.maxOutputTokens,
      temperature: TEMPERATURE_BY_POLICY_CLASS[policyClass],
    },
    budget,
  }
}

export function siteForgeRoleGatewayOptions(input: {
  role: SiteForgeAutonomousRole
  propertyId: string
  actorId?: string | null
}) {
  const policy = resolveSiteForgeRoleModelPolicy(input.role)
  return {
    user: input.actorId || input.propertyId,
    tags: [
      'feature:siteforge',
      `role:${input.role}`,
      `policy:${policy.policyVersion}`,
      `property:${input.propertyId}`,
    ],
  }
}

export function assertSiteForgeRoleUsageWithinBudget(input: {
  policy: SiteForgeRoleModelPolicy
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  attempt: number
}): void {
  const { policy } = input
  const violations = [
    input.inputTokens > policy.budget.maxInputTokens
      ? 'input token budget'
      : null,
    input.outputTokens > policy.budget.maxOutputTokens
      ? 'output token budget'
      : null,
    input.costUsd > policy.budget.maxCostUsd ? 'cost budget' : null,
    input.latencyMs > policy.budget.maxLatencyMs ? 'latency budget' : null,
    input.attempt > policy.budget.maxAttempts ? 'attempt budget' : null,
  ].filter((value): value is string => Boolean(value))

  if (violations.length > 0) {
    throw new Error(
      `SiteForge ${policy.role} exceeded ${violations.join(', ')}`
    )
  }
}
