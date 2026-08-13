import { beforeEach, describe, expect, it, vi } from 'vitest'

const productionMocks = vi.hoisted(() => ({
  certify: vi.fn(),
  fail: vi.fn(),
  markReconciliation: vi.fn(),
}))

vi.mock('@/utils/siteforge/workflows/production-steps', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/utils/siteforge/workflows/production-steps')
    >()
  return {
    ...actual,
    certifySiteForgeProduction: productionMocks.certify,
    failSiteForgeProductionCertification: productionMocks.fail,
    markSiteForgeProductionProjectionReconciliationRequired:
      productionMocks.markReconciliation,
  }
})

import { siteForgeProductionCertificationWorkflow } from './siteforge-production-certification'
import {
  ProductionProjectionReconciliationError,
  type SiteForgeProductionCertificationInput,
} from '@/utils/siteforge/workflows/production-steps'

const input: SiteForgeProductionCertificationInput = {
  sharedJobId: 'job-1',
  releaseId: 'release-1',
  actorId: 'actor-1',
  deploymentId: 'deployment-1',
  targetId: 'target-1',
  websiteId: 'website-1',
  propertyId: 'property-1',
  orgId: 'org-1',
  artifactId: 'artifact-1',
  contentHash: 'a'.repeat(64),
  productionUrl: 'https://example.com',
  startedAt: '2026-08-10T00:00:00.000Z',
}

describe('siteForgeProductionCertificationWorkflow failure routing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('keeps post-live projection failure retryable without requesting recovery', async () => {
    const error = new ProductionProjectionReconciliationError(
      'The live release projections require reconciliation'
    )
    productionMocks.certify.mockRejectedValue(error)

    await expect(
      siteForgeProductionCertificationWorkflow(input)
    ).rejects.toBe(error)

    expect(productionMocks.markReconciliation).toHaveBeenCalledWith(
      input,
      error.message
    )
    expect(productionMocks.fail).not.toHaveBeenCalled()
  })

  it('sends genuine certification failure into supervised recovery', async () => {
    const error = new Error('Public certification failed')
    productionMocks.certify.mockRejectedValue(error)

    await expect(
      siteForgeProductionCertificationWorkflow(input)
    ).rejects.toBe(error)

    expect(productionMocks.fail).toHaveBeenCalledWith(input, error.message)
    expect(productionMocks.markReconciliation).not.toHaveBeenCalled()
  })
})
