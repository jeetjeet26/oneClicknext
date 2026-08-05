import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACACIA_REGRESSION_BASELINE_V1 as acacia } from '@/fixtures/acacia-regression.v1'

const themeFunctions = readFileSync(
  new URL(
    '../../../../../../wordpress-theme/oneclick-siteforge/functions.php',
    import.meta.url
  ),
  'utf8'
)
const runtimeTransactions = readFileSync(
  new URL(
    '../../../../../../wordpress-plugin/oneclick-siteforge-runtime/includes/class-siteforge-runtime-transactions.php',
    import.meta.url
  ),
  'utf8'
)

describe('Acacia SiteForge theme runtime option compatibility', () => {
  it('continues reading the legacy option with the widget disabled by default', () => {
    expect(themeFunctions).toContain(
      `get_option( '${acacia.siteForge.compatibility.legacyThemeOption}', array() )`
    )
    expect(themeFunctions).toContain(
      "oneclick_get_field( 'lumaleasing_enabled', false )"
    )
    expect(
      acacia.siteForge.existingArtifactFeatureDefaults.chatbot
    ).toBe(false)
    expect(acacia.siteForge.existingArtifactFeatureDefaults.tours).toBe(false)
  })

  it('writes runtime-v2 state while retaining the legacy theme bridge', () => {
    expect(runtimeTransactions).toContain(
      `'${acacia.siteForge.compatibility.runtimeV2Option}'`
    )
    expect(runtimeTransactions).toContain(
      `'${acacia.siteForge.compatibility.legacyThemeOption}'`
    )
    expect(runtimeTransactions).toContain(
      "$legacy_runtime['certifiedContentHash']"
    )
  })
})
