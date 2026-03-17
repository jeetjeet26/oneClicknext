import { createRequestContext } from './request-context'

describe('request context', () => {
  it('reuses the incoming request id when present', () => {
    const request = new Request('http://localhost:3000/api/health', {
      method: 'GET',
      headers: {
        'x-request-id': 'existing-request-id',
      },
    })

    const context = createRequestContext(request, '/api/health')

    expect(context.requestId).toBe('existing-request-id')
    expect(context.responseHeaders['x-request-id']).toBe('existing-request-id')
  })

  it('generates a request id when one is missing', () => {
    const request = new Request('http://localhost:3000/api/documents', {
      method: 'DELETE',
    })

    const context = createRequestContext(request)

    expect(context.requestId).toBeTruthy()
    expect(context.route).toBe('/api/documents')
    expect(context.method).toBe('DELETE')
    expect(context.responseHeaders['x-request-id']).toBe(context.requestId)
  })
})
