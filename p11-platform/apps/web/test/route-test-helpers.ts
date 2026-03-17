import type { NextRequest } from 'next/server'
import { expect, type Mock } from 'vitest'

export function createMockServerClient(
  authGetUserMock: Mock,
  overrides: Record<string, unknown> = {}
) {
  return {
    auth: { getUser: authGetUserMock },
    ...overrides,
  }
}

export function mockUnauthenticatedUser(authGetUserMock: Mock) {
  authGetUserMock.mockResolvedValue({
    data: { user: null },
    error: null,
  })
}

export function mockAuthenticatedUser(authGetUserMock: Mock, userId = 'user-1') {
  authGetUserMock.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

export function mockForbiddenPropertyAccess(validatePropertyAccessMock: Mock) {
  validatePropertyAccessMock.mockResolvedValue({ authorized: false })
}

export function mockGrantedPropertyAccess(validatePropertyAccessMock: Mock) {
  validatePropertyAccessMock.mockResolvedValue({ authorized: true })
}

export function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

export function makeJsonRequest(
  url: string,
  options: {
    method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    body?: unknown
    headers?: Record<string, string>
  } = {}
): NextRequest {
  const { method = 'POST', body, headers = {} } = options
  return makeNextRequest(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function expectJsonError(
  response: Response,
  status: number,
  error: string
) {
  expect(response.status).toBe(status)
  await expect(response.json()).resolves.toEqual({ error })
}
