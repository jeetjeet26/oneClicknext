import { describe, expect, it } from 'vitest'
import { SITEFORGE_AUTONOMOUS_ROLES } from '@/utils/siteforge/autonomy/artifact-envelope'
import {
  assertSiteForgeRoleUsageWithinBudget,
  resolveSiteForgeRoleModelPolicy,
  siteForgeGatewayModelId,
  siteForgeRoleGatewayOptions,
} from './model-policy'

describe('SiteForge autonomous role model policy', () => {
  it('registers every versioned autonomous role with Gateway metadata', () => {
    for (const role of SITEFORGE_AUTONOMOUS_ROLES) {
      const policy = resolveSiteForgeRoleModelPolicy(role)
      expect(policy.role).toBe(role)
      expect(policy.policyVersion).toBe('siteforge.autonomy-model-policy.v1')
      expect(policy.modelId).toMatch(/^[a-z0-9._-]+\/[a-z0-9._-]+$/i)
      expect(policy.modelId.startsWith(`${policy.provider}/`)).toBe(true)
      expect(policy.settings.maxOutputTokens).toBe(
        policy.budget.maxOutputTokens
      )
    }
  })

  it('normalizes current bare Anthropic constants for AI Gateway', () => {
    expect(siteForgeGatewayModelId('claude-sonnet-5')).toBe(
      'anthropic/claude-sonnet-5'
    )
    expect(siteForgeGatewayModelId('openai/gpt-5.4')).toBe('openai/gpt-5.4')
    expect(() => siteForgeGatewayModelId('bad/model/id')).toThrow(
      /Invalid SiteForge Gateway model ID/
    )
  })

  it('provides Gateway attribution without coupling to an SDK call', () => {
    expect(
      siteForgeRoleGatewayOptions({
        role: 'truth-curator.v1',
        propertyId: 'property-1',
        actorId: 'user-1',
      })
    ).toEqual({
      user: 'user-1',
      tags: [
        'feature:siteforge',
        'role:truth-curator.v1',
        'policy:siteforge.autonomy-model-policy.v1',
        'property:property-1',
      ],
    })
  })

  it('rejects usage outside centralized role budgets', () => {
    const policy = resolveSiteForgeRoleModelPolicy('release-operator.v1')
    expect(() =>
      assertSiteForgeRoleUsageWithinBudget({
        policy,
        inputTokens: 100,
        outputTokens: policy.budget.maxOutputTokens + 1,
        costUsd: 0.1,
        latencyMs: 100,
        attempt: 1,
      })
    ).toThrow(/output token budget/)
  })
})
