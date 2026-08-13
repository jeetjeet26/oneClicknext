import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.dirname(testsDir)
const repoDir = path.dirname(path.dirname(pluginDir))
const themeDir = path.join(repoDir, 'wordpress-theme/oneclick-siteforge')

const source = async relative => readFile(path.join(pluginDir, relative), 'utf8')
const themeSource = async relative => readFile(path.join(themeDir, relative), 'utf8')

const transactions = await source('includes/class-siteforge-runtime-transactions.php')
const assets = await source('includes/class-siteforge-runtime-assets.php')
const header = await themeSource('header.php')
const utilities = await themeSource('inc/block-utilities.php')
const behavior = await themeSource('assets/js/site-behavior.js')
const functions = await themeSource('functions.php')
const plugin = await source('oneclick-siteforge-runtime.php')
const v3Validation = await source(
  'includes/class-siteforge-runtime-v3-validation.php'
)
const v3Transactions = await source(
  'includes/class-siteforge-runtime-v3-transactions.php'
)
const v3Materializer = await source(
  'includes/class-siteforge-runtime-v3-materializer.php'
)
const v3Controller = await source(
  'includes/class-siteforge-runtime-v3-rest-controller.php'
)
const plans = await themeSource('assets/js/plans.js')

assert(!transactions.includes("get_page_by_path( 'sample-page'"))
assert(transactions.includes('rollback_preparation'))
assert(transactions.includes('assert_rollback_readback'))
assert(assets.includes('PREPARATION_EFFECTS_OPTION'))
assert(header.includes('wp_nav_menu'))
assert(header.includes("'depth'          => 0"))
assert(!utilities.includes("$GLOBALS['block']"))
assert(behavior.includes('siteforge-back-to-top'))
assert(behavior.includes('prefers-reduced-motion'))
assert(behavior.includes("'informational'"))
assert(functions.includes('_siteforge_seo_title'))
assert(functions.includes('wpseo_frontend_presenters'))
assert(plugin.includes('SiteForge_Runtime_V3_REST_Controller'))
assert(plugin.includes("add_action( 'rest_api_init', array( $controller"))
assert(plugin.includes("add_action( 'rest_api_init', array( $v3_controller"))
assert(v3Controller.includes("const NAMESPACE = 'siteforge/v3'"))
assert(v3Controller.includes('assert_deployment_headers'))
assert(v3Controller.includes("'x-siteforge-runtime-archive-sha256'"))
assert(v3Controller.includes("'if-none-match', '*'"))
assert(v3Validation.includes("'Package ids'") || v3Validation.includes('$package_ids'))
assert(v3Validation.includes('assert_extension_scopes'))
assert(v3Validation.includes('Operation must bind to the exact desired resource identity.'))
assert(v3Transactions.includes('rollback_preparation'))
assert(v3Transactions.includes('state->restore'))
assert(v3Transactions.includes('materializer->apply'))
assert(v3Transactions.includes('materializer->restore'))
assert(v3Materializer.includes('PAGE_SITE_META'))
assert(v3Materializer.includes('assert_inventory_fresh'))
assert(v3Materializer.includes('materialization_readback_failed'))
assert(!plans.includes('generateMockPlans'))
assert(!plans.includes('Floor plan placeholder'))
assert(plans.includes('inventory unavailable'))

for (const name of await readdir(path.join(themeDir, 'blocks'))) {
  if (!name.endsWith('.php')) continue
  const block = await themeSource(path.join('blocks', name))
  if (block.includes('oneclick_get_block_wrapper_attributes(')) {
    assert(
      block.includes('oneclick_get_block_wrapper_attributes( $block,'),
      `${name} must pass its local ACF block`
    )
  }
}

for (const fixturesDir of [
  path.join(testsDir, 'fixtures'),
  path.join(pluginDir, 'fixtures/v2'),
  path.join(pluginDir, 'fixtures/v3'),
]) {
  for (const name of await readdir(fixturesDir)) {
    if (name.endsWith('.json')) {
      JSON.parse(await readFile(path.join(fixturesDir, name), 'utf8'))
    }
  }
}

const v3Release = JSON.parse(
  await readFile(path.join(pluginDir, 'fixtures/v3/release.json'), 'utf8')
)
const v3Capabilities = JSON.parse(
  await readFile(path.join(pluginDir, 'fixtures/v3/capabilities.json'), 'utf8')
)
const v3EmptyState = JSON.parse(
  await readFile(path.join(pluginDir, 'fixtures/v3/empty-state.json'), 'utf8')
)
const v3Projection = JSON.parse(
  await readFile(path.join(pluginDir, 'fixtures/v3/projection-v2.json'), 'utf8')
)
assert.equal(v3Release.contractVersion, 3)
assert.equal(v3Capabilities.contractVersion, 3)
assert.equal(v3EmptyState.contractVersion, 3)
assert.equal(v3Projection.contractVersion, 3)
assert.equal(v3Projection.projection.contractVersion, 2)
assert.equal(v3Capabilities.features.completeResourceGraph, true)
assert.equal(v3Capabilities.features.exactPackageIdentity, true)
for (const key of [
  'pages',
  'sections',
  'globalComponents',
  'chrome',
  'forms',
  'redirects',
  'responsiveRules',
  'accessibilityAnnotations',
  'seo',
  'legal',
  'analytics',
  'integrations',
  'assets',
  'removals',
]) {
  assert(key in v3Release.resourceGraph, `v3 release fixture missing ${key}`)
}

console.log('SiteForge runtime static parity tests passed.')
