export interface RequestContext {
  requestId: string
  route: string
  method: string
  startedAt: number
  responseHeaders: Record<string, string>
  logStart: (details?: Record<string, unknown>) => void
  logSuccess: (status: number, details?: Record<string, unknown>) => void
  logError: (
    status: number,
    error: unknown,
    details?: Record<string, unknown>
  ) => void
}

function buildLogPayload(
  level: 'info' | 'error',
  event: 'request_start' | 'request_success' | 'request_error',
  context: RequestContext,
  details?: Record<string, unknown>
): string {
  return JSON.stringify({
    level,
    event,
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    durationMs:
      event === 'request_start' ? undefined : Date.now() - context.startedAt,
    ...details,
  })
}

export function createRequestContext(
  request: Request,
  route?: string
): RequestContext {
  const requestId =
    request.headers.get('x-request-id') ||
    request.headers.get('x-correlation-id') ||
    crypto.randomUUID()

  const requestRoute = route || new URL(request.url).pathname

  const context: RequestContext = {
    requestId,
    route: requestRoute,
    method: request.method,
    startedAt: Date.now(),
    responseHeaders: {
      'x-request-id': requestId,
    },
    logStart(details) {
      console.log(buildLogPayload('info', 'request_start', context, details))
    },
    logSuccess(status, details) {
      console.log(
        buildLogPayload('info', 'request_success', context, {
          status,
          ...details,
        })
      )
    },
    logError(status, error, details) {
      console.error(
        buildLogPayload('error', 'request_error', context, {
          status,
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                }
              : { message: String(error) },
          ...details,
        })
      )
    },
  }

  return context
}
