import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getDataEngineUrl } from '@/utils/services/runtime-config'
import {
  DEFAULT_AUDIT_SURFACES,
  getSurfaceLabel,
  isSupportedSurface,
  type Surface,
} from '@/utils/propertyaudit/types'

type SurfaceReadiness = {
  surface: Surface
  label: string
  ready: boolean
  requiredKeys: string[]
  missingKeys: string[]
  warnings: string[]
}

function requiredKeysForSurface(surface: Surface): string[] {
  switch (surface) {
    case 'openai':
    case 'chatgpt':
      return ['OPENAI_API_KEY']
    case 'claude':
      return ['ANTHROPIC_API_KEY']
    case 'gemini':
      return ['GOOGLE_GEMINI_API_KEY', 'OPENAI_API_KEY_OR_ANTHROPIC_API_KEY']
    case 'perplexity':
      return ['PERPLEXITY_API_KEY', 'OPENAI_API_KEY_OR_ANTHROPIC_API_KEY']
    case 'google_ai':
      return ['SERPAPI_API_KEY', 'OPENAI_API_KEY_OR_ANTHROPIC_API_KEY']
  }
}

function hasKey(name: string): boolean {
  if (name === 'OPENAI_API_KEY_OR_ANTHROPIC_API_KEY') {
    return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY)
  }
  return Boolean(process.env[name])
}

function buildSurfaceReadiness(surface: Surface): SurfaceReadiness {
  const requiredKeys = requiredKeysForSurface(surface)
  const missingKeys = requiredKeys.filter(key => !hasKey(key))
  const warnings: string[] = []

  if (surface === 'google_ai') {
    warnings.push('Google AI is measured as a Google-grounded proxy, not exact consumer AI Overview capture.')
  }
  if (surface === 'claude') {
    warnings.push('Claude is retained as a legacy/optional surface, not part of the default sellable v1 set.')
  }

  return {
    surface,
    label: getSurfaceLabel(surface),
    ready: missingKeys.length === 0,
    requiredKeys,
    missingKeys,
    warnings,
  }
}

async function checkDataEngine() {
  if (process.env.PROPERTYAUDIT_USE_DATA_ENGINE === 'false') {
    return {
      enabled: false,
      ready: false,
      url: getDataEngineUrl(),
      message: 'Data-engine dispatch is explicitly disabled by PROPERTYAUDIT_USE_DATA_ENGINE=false.',
    }
  }

  const url = getDataEngineUrl()
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
    return {
      enabled: true,
      ready: response.ok && Boolean(process.env.DATA_ENGINE_API_KEY),
      url,
      message: response.ok
        ? process.env.DATA_ENGINE_API_KEY
          ? 'Data engine is reachable.'
          : 'DATA_ENGINE_API_KEY is missing.'
        : `Data engine health returned ${response.status}.`,
    }
  } catch (error) {
    return {
      enabled: true,
      ready: false,
      url,
      message: error instanceof Error ? error.message : 'Data engine health check failed.',
    }
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = req.nextUrl.searchParams
  const propertyId = searchParams.get('propertyId')
  const requestedSurfaces = (searchParams.get('surfaces') || '')
    .split(',')
    .map(surface => surface.trim())
    .filter(Boolean)

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const surfaces = requestedSurfaces.length > 0
    ? requestedSurfaces.filter((surface): surface is Surface => isSupportedSurface(surface))
    : DEFAULT_AUDIT_SURFACES

  if (surfaces.length === 0) {
    return NextResponse.json({ error: 'No supported surfaces requested' }, { status: 400 })
  }

  const surfaceReadiness = surfaces.map(buildSurfaceReadiness)
  const dataEngine = await checkDataEngine()
  const runtimeReady = dataEngine.ready

  return NextResponse.json({
    ready: surfaceReadiness.every(surface => surface.ready) && runtimeReady,
    surfaces: surfaceReadiness,
    runtime: {
      dataEngine,
      processor: 'data_engine',
      ready: runtimeReady,
    },
  })
}
