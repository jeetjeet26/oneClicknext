export function isSiteForgeSemanticEditorEnabled(
  value = process.env.SITEFORGE_SEMANTIC_EDITOR_ENABLED
): boolean {
  return value?.trim().toLowerCase() !== 'false'
}

export function isSiteForgeRuntimeExtensionsEnabled(
  value = process.env.SITEFORGE_RUNTIME_EXTENSIONS_ENABLED
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isCloudwaysThemeInstallationConfigured(input: {
  apiKey?: string
  email?: string
  acfLicenseKey?: string
}): boolean {
  const apiKey = input.apiKey?.trim() || ''
  const email = input.email?.trim() || ''
  const acfLicenseKey = input.acfLicenseKey?.trim() || ''
  return (
    apiKey.length >= 20 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) &&
    acfLicenseKey.length >= 10
  )
}

export function assertSiteForgeSemanticEditorEnabled(): void {
  if (!isSiteForgeSemanticEditorEnabled()) {
    throw new Error('SiteForge semantic editor is disabled')
  }
}
