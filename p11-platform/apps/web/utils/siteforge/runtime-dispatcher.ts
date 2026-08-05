import {
  SiteForgeRuntimeClient,
  type SiteForgeRuntimeClientOptions,
} from '@/utils/siteforge/wordpress/runtime-client'
import {
  SiteForgeRuntimeV3Client,
  type SiteForgeRuntimeV3ClientOptions,
} from '@/utils/siteforge/wordpress/runtime-client-v3'

export type SiteForgeRuntimeContractVersion = 1 | 2 | 3

export class UnsupportedSiteForgeRuntimeContractError extends Error {
  readonly contractVersion: unknown

  constructor(contractVersion: unknown) {
    super(`Unsupported SiteForge runtime contract version: ${String(contractVersion)}`)
    this.name = 'UnsupportedSiteForgeRuntimeContractError'
    this.contractVersion = contractVersion
  }
}

export function parseSiteForgeRuntimeContractVersion(
  contractVersion: unknown
): SiteForgeRuntimeContractVersion {
  switch (contractVersion) {
    case 1:
    case 2:
    case 3:
      return contractVersion
    default:
      throw new UnsupportedSiteForgeRuntimeContractError(contractVersion)
  }
}

export function dispatchSiteForgeRuntimeContract<T>(input: {
  contractVersion: unknown
  v1: () => T
  v2: () => T
  v3: () => T
}): T {
  switch (parseSiteForgeRuntimeContractVersion(input.contractVersion)) {
    case 1:
      return input.v1()
    case 2:
      return input.v2()
    case 3:
      return input.v3()
  }
}

export function isSiteForgeRuntimeBackedContractVersion(
  contractVersion: unknown
): contractVersion is 2 | 3 {
  return contractVersion === 2 || contractVersion === 3
}

export function siteForgeRuntimeNamespace(
  contractVersion: unknown
): 'siteforge/v1' | 'siteforge/v2' | 'siteforge/v3' {
  return dispatchSiteForgeRuntimeContract({
    contractVersion,
    v1: () => 'siteforge/v1',
    v2: () => 'siteforge/v2',
    v3: () => 'siteforge/v3',
  })
}

export function createSiteForgeRuntimeClientForVersion(
  contractVersion: 2,
  options: SiteForgeRuntimeClientOptions
): SiteForgeRuntimeClient
export function createSiteForgeRuntimeClientForVersion(
  contractVersion: 3,
  options: SiteForgeRuntimeV3ClientOptions
): SiteForgeRuntimeV3Client
export function createSiteForgeRuntimeClientForVersion(
  contractVersion: unknown,
  options: SiteForgeRuntimeClientOptions | SiteForgeRuntimeV3ClientOptions
): SiteForgeRuntimeClient | SiteForgeRuntimeV3Client
export function createSiteForgeRuntimeClientForVersion(
  contractVersion: unknown,
  options: SiteForgeRuntimeClientOptions | SiteForgeRuntimeV3ClientOptions
): SiteForgeRuntimeClient | SiteForgeRuntimeV3Client {
  return dispatchSiteForgeRuntimeContract<
    SiteForgeRuntimeClient | SiteForgeRuntimeV3Client
  >({
    contractVersion,
    v1: () => {
      throw new Error(
        'SiteForge contract v1 is theme-backed and has no transaction runtime client'
      )
    },
    v2: () => new SiteForgeRuntimeClient(options),
    v3: () => new SiteForgeRuntimeV3Client(options),
  })
}
