import { describe, expect, it } from 'vitest'
import {
  UnsupportedSiteForgeRuntimeContractError,
  createSiteForgeRuntimeClientForVersion,
  dispatchSiteForgeRuntimeContract,
  isSiteForgeRuntimeBackedContractVersion,
  parseSiteForgeRuntimeContractVersion,
  siteForgeRuntimeNamespace,
} from './runtime-dispatcher'
import { SiteForgeRuntimeClient } from './wordpress/runtime-client'
import { SiteForgeRuntimeV3Client } from './wordpress/runtime-client-v3'

describe('SiteForge exact runtime version dispatcher', () => {
  it.each([
    [1, 'v1', 'siteforge/v1'],
    [2, 'v2', 'siteforge/v2'],
    [3, 'v3', 'siteforge/v3'],
  ] as const)('dispatches exact contract %i', (contractVersion, result, namespace) => {
    expect(
      dispatchSiteForgeRuntimeContract({
        contractVersion,
        v1: () => 'v1',
        v2: () => 'v2',
        v3: () => 'v3',
      })
    ).toBe(result)
    expect(siteForgeRuntimeNamespace(contractVersion)).toBe(namespace)
    expect(parseSiteForgeRuntimeContractVersion(contractVersion)).toBe(
      contractVersion
    )
  })

  it.each([0, 4, 30, -1, 2.1, '3', null, undefined])(
    'fails closed for unknown version %j',
    contractVersion => {
      expect(() =>
        dispatchSiteForgeRuntimeContract({
          contractVersion,
          v1: () => 'v1',
          v2: () => 'v2',
          v3: () => 'v3',
        })
      ).toThrow(UnsupportedSiteForgeRuntimeContractError)
    }
  )

  it('recognizes only exact transaction-backed versions', () => {
    expect(isSiteForgeRuntimeBackedContractVersion(1)).toBe(false)
    expect(isSiteForgeRuntimeBackedContractVersion(2)).toBe(true)
    expect(isSiteForgeRuntimeBackedContractVersion(3)).toBe(true)
    expect(isSiteForgeRuntimeBackedContractVersion(4)).toBe(false)
  })

  it('constructs v2 and v3 clients without cross-version fallback', () => {
    const options = {
      baseUrl: 'https://wordpress.example.com',
      username: 'runtime',
      applicationPassword: 'application password',
      fetch,
    }
    expect(createSiteForgeRuntimeClientForVersion(2, options)).toBeInstanceOf(
      SiteForgeRuntimeClient
    )
    expect(createSiteForgeRuntimeClientForVersion(3, options)).toBeInstanceOf(
      SiteForgeRuntimeV3Client
    )
    expect(() =>
      createSiteForgeRuntimeClientForVersion(4, options)
    ).toThrow(UnsupportedSiteForgeRuntimeContractError)
  })
})
