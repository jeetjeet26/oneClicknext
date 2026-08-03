import { beforeEach, describe, expect, it, vi } from 'vitest'

const updatePayloads: Array<Record<string, unknown>> = []

const eqMock = vi.fn(async () => ({ error: null }))
const updateMock = vi.fn((payload: Record<string, unknown>) => {
  updatePayloads.push(payload)
  return { eq: eqMock }
})
const fromMock = vi.fn(() => ({ update: updateMock }))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock }),
}))

vi.mock('./brand-agent', () => ({
  BrandAgent: class MockBrandAgent {},
}))
vi.mock('./architecture-agent', () => ({
  ArchitectureAgent: class MockArchitectureAgent {},
}))
vi.mock('./design-agent', () => ({
  DesignAgent: class MockDesignAgent {},
}))
vi.mock('./photo-agent', () => ({
  PhotoAgent: class MockPhotoAgent {},
}))
vi.mock('./content-agent', () => ({
  ContentAgent: class MockContentAgent {},
}))
vi.mock('./quality-agent', () => ({
  QualityAgent: class MockQualityAgent {},
}))
vi.mock('@/utils/mcp/wordpress-client', () => ({
  WordPressMcpClient: class MockWordPressMcpClient {},
}))

type OrchestratorInternals = {
  agents: {
    brand: { analyze: () => Promise<Record<string, unknown>> }
    architecture: { plan: () => Promise<Record<string, unknown>> }
    design: { createSystem: () => Promise<Record<string, unknown>> }
    photo: {
      planStrategy: () => Promise<Record<string, unknown>>
      execute: () => Promise<Record<string, unknown>>
    }
    content: { generateAll: () => Promise<Array<Record<string, unknown>>> }
    quality: { validate: () => Promise<Record<string, unknown>> }
  }
  wpMcp: { getCapabilities: () => Promise<Record<string, unknown>> }
}

function configureOrchestrator(passed: boolean) {
  return {
    agents: {
      brand: {
        analyze: vi.fn(async () => ({
          source: 'brandforge',
          confidence: 0.9,
        })),
      },
      architecture: {
        plan: vi.fn(async () => ({ pages: [] })),
      },
      design: {
        createSystem: vi.fn(async () => ({})),
      },
      photo: {
        planStrategy: vi.fn(async () => ({})),
        execute: vi.fn(async () => ({ assignments: {} })),
      },
      content: {
        generateAll: vi.fn(async () => []),
      },
      quality: {
        validate: vi.fn(async () => ({
          score: passed ? 92 : 61,
          passed,
          checks: {},
          improvements: [],
          timestamp: new Date().toISOString(),
        })),
      },
    },
    wpMcp: {
      getCapabilities: vi.fn(async () => ({})),
    },
  }
}

describe('SiteForgeOrchestrator readiness', () => {
  beforeEach(() => {
    updatePayloads.length = 0
    vi.clearAllMocks()
  })

  it('persists the complete blueprint before publishing preview readiness', async () => {
    const { SiteForgeOrchestrator } = await import('./orchestrator')
    const orchestrator = new SiteForgeOrchestrator('property-1', 'website-1')
    Object.assign(orchestrator as unknown as OrchestratorInternals, configureOrchestrator(true))

    await orchestrator.generate({ style: 'modern' })

    const blueprintIndex = updatePayloads.findIndex((payload) => 'blueprint' in payload)
    const readyIndex = updatePayloads.findIndex(
      (payload) => payload.generation_status === 'ready_for_preview'
    )

    expect(blueprintIndex).toBeGreaterThan(-1)
    expect(readyIndex).toBeGreaterThan(blueprintIndex)
  })

  it('keeps the AI quality report advisory when its score is below target', async () => {
    const { SiteForgeOrchestrator } = await import('./orchestrator')
    const orchestrator = new SiteForgeOrchestrator('property-1', 'website-1')
    Object.assign(orchestrator as unknown as OrchestratorInternals, configureOrchestrator(false))

    await orchestrator.generate()

    expect(updatePayloads.some((payload) => 'blueprint' in payload)).toBe(true)
    expect(
      updatePayloads.some((payload) => payload.generation_status === 'ready_for_preview')
    ).toBe(true)
    expect(
      updatePayloads.some((payload) => payload.generation_status === 'failed')
    ).toBe(false)
  })
})
