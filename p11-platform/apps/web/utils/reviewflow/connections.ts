/**
 * Connection DTO redaction.
 *
 * review_platform_connections rows carry credentials (api_key, access_token,
 * refresh_token). Those values must never leave the server. API responses use
 * this DTO, which replaces secret values with presence booleans.
 */

export const CONNECTION_SECRET_FIELDS = ['api_key', 'access_token', 'refresh_token'] as const

export type RedactedConnection = Record<string, unknown> & {
  has_api_key: boolean
  has_access_token: boolean
  has_refresh_token: boolean
}

export function redactConnection(row: Record<string, unknown>): RedactedConnection {
  const {
    api_key: apiKey,
    access_token: accessToken,
    refresh_token: refreshToken,
    ...safe
  } = row

  return {
    ...safe,
    has_api_key: typeof apiKey === 'string' && apiKey.length > 0,
    has_access_token: typeof accessToken === 'string' && accessToken.length > 0,
    has_refresh_token: typeof refreshToken === 'string' && refreshToken.length > 0,
  }
}

export function redactConnections(rows: Array<Record<string, unknown>>): RedactedConnection[] {
  return rows.map(redactConnection)
}
