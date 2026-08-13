import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  generateSiteForgeAcf,
  siteForgeAcfOutputDir,
} from './generate-siteforge-acf.mjs'
import {
  themeDir,
  validateSiteForgeTheme,
} from './build-siteforge-theme.mjs'

export async function validateSiteForgeBuildInputs({
  deploymentEnvironment = process.env.VERCEL,
  sourceThemeDir = themeDir,
  acfOutputDir = siteForgeAcfOutputDir,
} = {}) {
  try {
    await Promise.all([
      access(path.join(sourceThemeDir, 'theme.json')),
      access(acfOutputDir),
    ])
  } catch (error) {
    if (error?.code === 'ENOENT' && deploymentEnvironment === '1') {
      return { skipped: true }
    }
    throw error
  }

  const acf = await generateSiteForgeAcf({
    outputDirectory: acfOutputDir,
    check: true,
  })
  const theme = await validateSiteForgeTheme()
  return { skipped: false, acf, theme }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const result = await validateSiteForgeBuildInputs()
  if (result.skipped) {
    console.log(
      'Skipped source-only SiteForge theme validation because the Vercel deploy root excludes monorepo WordPress sources.'
    )
  } else {
    console.log(
      `Verified ${result.acf.count} SiteForge ACF field groups and validated SiteForge theme ${result.theme.version} (${result.theme.files.length} files).`
    )
  }
}
