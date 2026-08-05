import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const themeRoot = path.resolve(
  process.cwd(),
  '../../../wordpress-theme/oneclick-siteforge'
)

describe('generated WordPress customer journey', () => {
  it('renders persisted ACF floor-plan rows instead of replacing inventory with placeholders', async () => {
    const [template, browser] = await Promise.all([
      readFile(path.join(themeRoot, 'blocks/plans-availability.php'), 'utf8'),
      readFile(path.join(themeRoot, 'assets/js/plans.js'), 'utf8'),
    ])

    expect(template).toContain(
      "oneclick_get_block_field( 'floor_plans', $block, array() )"
    )
    expect(template).toContain('data-floor-plan-row')
    expect(template).toContain("['availability_url']")
    expect(template).toContain("['apply_url']")
    expect(browser).toContain(
      "container.querySelectorAll('[data-floor-plan-row]')"
    )
    expect(browser).not.toMatch(
      /publishedRows\.length\s*>\s*0[\s\S]{0,120}renderPlanPlaceholders/
    )
  })

  it('posts retry-stable WordPress form payloads with explicit consent evidence', async () => {
    const [template, handler] = await Promise.all([
      readFile(path.join(themeRoot, 'blocks/form.php'), 'utf8'),
      readFile(path.join(themeRoot, 'assets/js/form-handler.js'), 'utf8'),
    ])

    expect(template).toContain('name="consent_text"')
    expect(template).toContain("$provider_supported = 'p11_lumaleasing' === $provider")
    expect(template).toContain("$field_id_prefix = 'form-'")
    expect(template).toContain("$field_id_prefix . '-name'")
    expect(template).toContain("$field_id_prefix . '-consent'")
    expect(template).not.toContain('id="form-name"')
    expect(handler).toContain('data.submission_id = submissionId')
    expect(handler).toContain("data.consent = formData.has('consent')")
    expect(handler).toContain('data.page_url = window.location.href')
    expect(handler).toContain('window.SiteForgeConsent.state()')
    expect(handler).toContain(
      "['granted', 'denied', 'not_required'].includes(storedConsent.state)"
    )
    expect(handler).not.toContain(
      "data.analytics_consent = window.localStorage.getItem"
    )
  })

  it('renders sourced map details without requiring a Google Maps key', async () => {
    const template = await readFile(path.join(themeRoot, 'blocks/map.php'), 'utf8')

    expect(template).toContain("oneclick_get_block_field( 'address', $block )")
    expect(template).toContain("oneclick_get_block_field( 'latitude', $block )")
    expect(template).toContain("oneclick_get_block_field( 'longitude', $block )")
    expect(template).toContain('data-map-state="keyless"')
    expect(template).toContain('https://www.google.com/maps/dir/?api=1&destination=')
    expect(template).toContain('Property location details are not available.')
    expect(template).not.toContain(
      'empty( $property_address ) || empty( $property_lat ) || empty( $property_lng ) || empty( $api_key )'
    )
  })
})
