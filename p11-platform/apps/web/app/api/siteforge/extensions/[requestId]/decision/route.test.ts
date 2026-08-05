import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { strToU8, zipSync } from 'fflate'
import { buildOverlayPackageManifest } from '@/utils/siteforge/editor/overlay'
import {
  computeOverlayContentHash,
  computeOverlaySignature,
  sha256OverlayValue,
} from '@/utils/siteforge/editor/overlay-contract'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const {
  getUserMock,
  createServiceClientMock,
  replaceOverlayMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  replaceOverlayMock: vi.fn((artifact, overlay) => ({
    ...(artifact as Record<string, unknown>),
    themeOverlay: overlay,
    contentHash: 'f'.repeat(64),
  })),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/siteforge/wordpress/theme-artifact', () => ({
  replaceWordPressThemeArtifactOverlay: replaceOverlayMock,
}))

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333'
const ORG_ID = '44444444-4444-4444-8444-444444444444'
const SOURCE_ID = '55555555-5555-4555-8555-555555555555'
const OVERLAY_ID = '66666666-6666-4666-8666-666666666666'
const PUBLISHED_ID = '77777777-7777-4777-8777-777777777777'
const SIGNING_SECRET = 'test-signing-secret'

function request(body: unknown): NextRequest {
  return new Request(
    'http://localhost/api/siteforge/extensions/request/decision',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

function fixture(status = 'proposed') {
  const proposal = {
    reason: 'Semantic operations cannot express this interaction',
    files: [
      {
        path: 'assets/js/reviewed.js',
        content: 'document.body.classList.add("reviewed")',
      },
    ],
  }
  const { functionsPhp, styleCss, manifest } =
    buildOverlayPackageManifest(proposal)
  const contentHash = computeOverlayContentHash(proposal.reason, manifest)
  const archive = zipSync({
    'assets/js/reviewed.js': strToU8(proposal.files[0].content),
    'functions.php': strToU8(functionsPhp),
    'style.css': strToU8(styleCss),
    'siteforge-overlay.json': strToU8(
      JSON.stringify({
        descriptorVersion: 1,
        overlayContentHash: contentHash,
        manifest,
        reason: proposal.reason,
      })
    ),
  })
  const packageSha256 = sha256OverlayValue(archive)
  const signature = computeOverlaySignature({
    websiteId: WEBSITE_ID,
    contentHash,
    packageSha256,
    signingSecret: SIGNING_SECRET,
  })
  const validationReport = {
    passed: true,
    validator: 'siteforge-static-sandbox-v1',
    checks: [],
  }
  const compatibility = {
    contractVersion: 1,
    overlayId: OVERLAY_ID,
    contentHash,
    sourceArtifactId: SOURCE_ID,
    sourceContentHash: 'a'.repeat(64),
    packageSha256,
    signature,
    storage: {
      bucket: 'siteforge-artifacts',
      path: `overlays/${WEBSITE_ID}/${contentHash}.zip`,
    },
    validation: {
      validator: 'siteforge-static-sandbox-v1',
      reportSha256: hashSiteForgeContent(validationReport),
    },
  }
  return {
    archive,
    extension: {
      id: REQUEST_ID,
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      website_id: WEBSITE_ID,
      artifact_id: SOURCE_ID,
      capability: 'reviewed interaction',
      reason: proposal.reason,
      requested_behavior: 'Add the reviewed behavior',
      status,
      immutable_package_sha256: packageSha256,
      runtime_compatibility: JSON.stringify(compatibility),
      decision_by: status === 'building' ? 'manager-1' : null,
      created_at: '2026-08-04T12:00:00.000Z',
    },
    profile: { org_id: ORG_ID, role: 'manager' },
    website: { current_artifact_version_id: SOURCE_ID },
    source: {
      id: SOURCE_ID,
      website_id: WEBSITE_ID,
      property_id: PROPERTY_ID,
      org_id: ORG_ID,
      blueprint: { wordpressThemeArtifact: { source: true } },
      content_hash: 'a'.repeat(64),
      quality_report: {},
      quality_score: 100,
      asset_manifest: [],
      asset_manifest_hash: hashSiteForgeContent([]),
      base_theme_package_id: 'base-theme-v1',
      base_theme_package_sha256: 'b'.repeat(64),
      runtime_contract_version: 2,
      runtime_package_sha256: 'c'.repeat(64),
    },
    overlay: {
      id: OVERLAY_ID,
      content_hash: contentHash,
      manifest,
      storage_path: compatibility.storage.path,
      package_sha256: packageSha256,
      signature,
      validation_report: validationReport,
    },
  }
}

function serviceFor(
  initial: ReturnType<typeof fixture>,
  options: {
    claimSucceeds?: boolean
    lostRpcResponse?: boolean
    currentArtifact?: Record<string, unknown> | null
  } = {}
) {
  const state = {
    ...initial,
    currentArtifact: options.currentArtifact || null,
  }
  const rpcCalls: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const resultFor = (
    table: string,
    mode: 'select' | 'update',
    updateValue: Record<string, unknown> | null,
    filters: Record<string, unknown>
  ) => {
    if (mode === 'update') {
      updates.push(updateValue || {})
      if (table === 'siteforge_runtime_extension_requests') {
        if (
          updateValue?.status === 'building' &&
          options.claimSucceeds === false
        ) {
          return { data: null, error: null }
        }
        Object.assign(state.extension, updateValue)
        return { data: { id: REQUEST_ID, status: updateValue?.status }, error: null }
      }
      return { data: { id: 'updated' }, error: null }
    }
    if (table === 'profiles') return { data: state.profile, error: null }
    if (table === 'siteforge_runtime_extension_requests') {
      if (filters.status && state.extension.status !== filters.status) {
        return { data: null, error: null }
      }
      return { data: state.extension, error: null }
    }
    if (table === 'property_websites') {
      return { data: state.website, error: null }
    }
    if (table === 'siteforge_blueprint_versions') {
      return {
        data:
          state.currentArtifact &&
          filters.id === state.currentArtifact.id
            ? state.currentArtifact
            : state.source,
        error: null,
      }
    }
    if (table === 'siteforge_theme_overlays') {
      return { data: state.overlay, error: null }
    }
    return { data: null, error: null }
  }
  const service = {
    from(table: string) {
      let mode: 'select' | 'update' = 'select'
      let updateValue: Record<string, unknown> | null = null
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query,
        update: (value: Record<string, unknown>) => {
          mode = 'update'
          updateValue = value
          return query
        },
        eq: (key: string, value: unknown) => {
          filters[key] = value
          return query
        },
        single: async () => resultFor(table, mode, updateValue, filters),
        maybeSingle: async () => resultFor(table, mode, updateValue, filters),
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown
        ) => Promise.resolve(resultFor(table, mode, updateValue, filters)).then(resolve),
      }
      return query
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([initial.archive]),
          error: null,
        }),
      }),
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcCalls.push(args)
      const identity = (
        args.p_blueprint as Record<string, unknown>
      ).themeOverlayIdentity as Record<string, unknown>
      state.currentArtifact = {
        id: PUBLISHED_ID,
        version: 2,
        content_hash: args.p_content_hash,
        parent_version_id: SOURCE_ID,
        theme_overlay_id: identity.overlayId,
        overlay_package_sha256: identity.packageSha256,
        blueprint: args.p_blueprint,
      }
      state.website.current_artifact_version_id = PUBLISHED_ID
      return {
        data: options.lostRpcResponse ? null : state.currentArtifact,
        error: options.lostRpcResponse
          ? { message: 'connection lost after commit' }
          : null,
      }
    },
  }
  return { service, state, rpcCalls, updates }
}

describe('SiteForge runtime extension decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_RUNTIME_EXTENSIONS_ENABLED', 'true')
    vi.stubEnv('SITEFORGE_OVERLAY_SIGNING_SECRET', SIGNING_SECRET)
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('validates the request identity and decision before side effects', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ decision: 'execute', reason: '' }), {
      params: Promise.resolve({ requestId: 'invalid' }),
    })
    expect(response.status).toBe(400)
  })

  it('requires authentication for extension approval', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({ decision: 'approved', reason: 'Approved for sandbox review' }),
      {
        params: Promise.resolve({
          requestId: REQUEST_ID,
        }),
      }
    )
    expect(response.status).toBe(401)
  })

  it('rejects approval by a role outside the source organization', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    const data = fixture()
    data.profile = { org_id: 'other-org', role: 'viewer' }
    createServiceClientMock.mockReturnValue(serviceFor(data).service)

    const { POST } = await import('./route')
    const response = await POST(
      request({
        decision: 'approved',
        reason: 'Approved for signed sandbox validation',
      }),
      {
        params: Promise.resolve({
          requestId: REQUEST_ID,
        }),
      }
    )
    expect(response.status).toBe(403)
  })

  it('fails closed when the exact source revision is stale', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    const data = fixture()
    data.website.current_artifact_version_id = PUBLISHED_ID
    createServiceClientMock.mockReturnValue(serviceFor(data).service)
    const { POST } = await import('./route')
    const response = await POST(
      request({ decision: 'approved', reason: 'Reviewed' }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) }
    )
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('extension_source_stale')
  })

  it('rejects a concurrent proposed-to-building decision claim', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    const data = fixture()
    const mocked = serviceFor(data, { claimSucceeds: false })
    createServiceClientMock.mockReturnValue(mocked.service)
    const { POST } = await import('./route')
    const response = await POST(
      request({ decision: 'approved', reason: 'Reviewed' }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) }
    )
    expect(response.status).toBe(409)
    expect(mocked.rpcCalls).toHaveLength(0)
  })

  it('reconciles a lost publication response without duplicating a revision', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    const data = fixture()
    const mocked = serviceFor(data, { lostRpcResponse: true })
    createServiceClientMock.mockReturnValue(mocked.service)
    const { POST } = await import('./route')
    const response = await POST(
      request({ decision: 'approved', reason: 'Reviewed and approved' }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) }
    )
    expect(response.status).toBe(200)
    expect(mocked.rpcCalls).toHaveLength(1)
    expect(await response.json()).toEqual(
      expect.objectContaining({
        status: 'approved',
        artifact: expect.objectContaining({
          id: PUBLISHED_ID,
          parentArtifactId: SOURCE_ID,
          themeOverlayId: OVERLAY_ID,
          packageSha256: data.overlay.package_sha256,
        }),
      })
    )
  })

  it('reconciles an existing building revision and verifies exact trigger binding', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'manager-1' } },
      error: null,
    })
    const data = fixture('building')
    data.website.current_artifact_version_id = PUBLISHED_ID
    const currentArtifact = {
      id: PUBLISHED_ID,
      version: 2,
      content_hash: 'd'.repeat(64),
      parent_version_id: SOURCE_ID,
      theme_overlay_id: OVERLAY_ID,
      overlay_package_sha256: data.overlay.package_sha256,
      blueprint: {
        themeOverlayIdentity: {
          contractVersion: 1,
          overlayId: OVERLAY_ID,
          packageSha256: data.overlay.package_sha256,
          contentHash: data.overlay.content_hash,
          signature: data.overlay.signature,
        },
      },
    }
    const mocked = serviceFor(data, { currentArtifact })
    createServiceClientMock.mockReturnValue(mocked.service)
    const { POST } = await import('./route')
    const response = await POST(
      request({ decision: 'approved', reason: 'Retry after timeout' }),
      { params: Promise.resolve({ requestId: REQUEST_ID }) }
    )
    expect(response.status).toBe(200)
    expect(mocked.rpcCalls).toHaveLength(0)
    expect(await response.json()).toEqual(
      expect.objectContaining({
        reconciled: true,
        artifact: expect.objectContaining({
          parentArtifactId: SOURCE_ID,
          themeOverlayId: OVERLAY_ID,
          packageSha256: data.overlay.package_sha256,
        }),
      })
    )
  })
})
