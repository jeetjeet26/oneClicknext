const DEFAULT_APP_BASE_URL = 'http://localhost:3000'
const DEFAULT_DATA_ENGINE_URL = 'http://localhost:8000'

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function isHostedRuntime(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return false
  }

  return (
    process.env.VERCEL === '1' ||
    process.env.RENDER === 'true' ||
    typeof process.env.RENDER_SERVICE_ID === 'string'
  )
}

export function getAppBaseUrl(): string {
  const configured = firstNonEmpty(
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL
  )

  if (configured) {
    return stripTrailingSlash(configured)
  }

  if (isHostedRuntime()) {
    throw new Error(
      'Missing app base URL env. Set NEXT_PUBLIC_SITE_URL (preferred) or NEXT_PUBLIC_APP_URL/NEXT_PUBLIC_BASE_URL.'
    )
  }

  return DEFAULT_APP_BASE_URL
}

export function getDataEngineUrl(): string {
  const configured = firstNonEmpty(process.env.DATA_ENGINE_URL)

  if (configured) {
    return stripTrailingSlash(configured)
  }

  if (isHostedRuntime()) {
    throw new Error('Missing DATA_ENGINE_URL. Set DATA_ENGINE_URL in hosted environments.')
  }

  return DEFAULT_DATA_ENGINE_URL
}
