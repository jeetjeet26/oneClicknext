import { afterEach, expect, it, vi } from 'vitest'

const browserRuntime = vi.hoisted(() => ({ loads: vi.fn() }))
vi.mock('playwright-core', () => {
  browserRuntime.loads()
  throw new Error('Cannot find module playwright-core/browsers.json')
})
vi.mock('@browserbasehq/sdk', () => ({ Browserbase: class {} }))

import { renderResearchDocument } from './research-renderer'

afterEach(() => vi.unstubAllEnvs())

it('keeps saved research readable when the optional browser runtime cannot load', async () => {
  expect(browserRuntime.loads).not.toHaveBeenCalled()
  vi.stubEnv('BROWSERBASE_API_KEY', 'test-key')
  vi.stubEnv('BROWSERBASE_PROJECT_ID', 'test-project')
  await expect(renderResearchDocument('subject', 'https://example.com/community', 'official')).resolves.toBeNull()
  expect(browserRuntime.loads).toHaveBeenCalledOnce()
})
