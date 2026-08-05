<?php
/**
 * Focused dependency-free contract tests.
 */

require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-validation.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-assets.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-state.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-validation.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-assets.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-transactions.php';

if ( ! defined( 'ONECLICK_SITEFORGE_RUNTIME_V3_VERSION' ) ) {
	define( 'ONECLICK_SITEFORGE_RUNTIME_V3_VERSION', '3.0.0' );
}

$siteforge_test_options       = array();
$siteforge_test_fail_resource = null;

function get_option( $name, $default = false ) {
	global $siteforge_test_options;
	return array_key_exists( $name, $siteforge_test_options ) ? $siteforge_test_options[ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	global $siteforge_test_options;
	$changed = ! array_key_exists( $name, $siteforge_test_options ) || $siteforge_test_options[ $name ] !== $value;
	$siteforge_test_options[ $name ] = $value;
	return $changed;
}

function add_option( $name, $value, $deprecated = '', $autoload = null ) {
	global $siteforge_test_options;
	if ( array_key_exists( $name, $siteforge_test_options ) ) {
		return false;
	}
	$siteforge_test_options[ $name ] = $value;
	return true;
}

function delete_option( $name ) {
	global $siteforge_test_options;
	$existed = array_key_exists( $name, $siteforge_test_options );
	unset( $siteforge_test_options[ $name ] );
	return $existed;
}

function apply_filters( $hook, $accepted, $resource_name = null ) {
	global $siteforge_test_fail_resource;
	if ( 'oneclick_siteforge_runtime_v3_resource_applied' === $hook && $resource_name === $siteforge_test_fail_resource ) {
		return false;
	}
	return $accepted;
}

$failures = 0;

function siteforge_test( $name, $callback ) {
	global $failures;
	try {
		$callback();
		fwrite( STDOUT, "PASS {$name}\n" );
	} catch ( Throwable $error ) {
		++$failures;
		fwrite( STDERR, "FAIL {$name}: {$error->getMessage()}\n" );
	}
}

function siteforge_fixture( $name ) {
	$path = dirname( __DIR__ ) . '/fixtures/v2/' . $name . '.json';
	$data = json_decode( file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) {
		throw new RuntimeException( 'Could not decode fixture ' . $name );
	}
	return $data;
}

function siteforge_v3_fixture( $name ) {
	$path = dirname( __DIR__ ) . '/fixtures/v3/' . $name . '.json';
	$data = json_decode( file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) {
		throw new RuntimeException( 'Could not decode v3 fixture ' . $name );
	}
	return $data;
}

function siteforge_assert( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

function siteforge_v3_reset_options() {
	global $siteforge_test_options, $siteforge_test_fail_resource;
	$siteforge_test_options       = array();
	$siteforge_test_fail_resource = null;
}

function siteforge_v3_asset_request( $release ) {
	$identity = $release['identity'];
	return array(
		'contractVersion' => 3,
		'identity'        => $identity,
		'idempotencyKey'  => SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 3,
				'scope'                     => 'asset_preparation',
				'identity'                  => $identity,
				'expectedRemoteContentHash' => null,
			)
		),
		'assets'          => array_map(
			static function ( $asset ) use ( $release ) {
				foreach ( $release['assetSources'] as $source ) {
					if ( $source['assetId'] === $asset['assetId'] ) {
						return array( 'asset' => $asset, 'source' => $source );
					}
				}
				throw new RuntimeException( 'Missing v3 fixture asset source.' );
			},
			$release['resourceGraph']['assets']
		),
	);
}

function siteforge_v3_store_preparation( $release, $preparation_id ) {
	$asset_request = siteforge_v3_asset_request( $release );
	$assets = array();
	foreach ( $release['resourceGraph']['assets'] as $index => $asset ) {
		$assets[] = array(
			'assetId'      => $asset['assetId'],
			'byteSha256'   => $asset['byteSha256'],
			'attachmentId' => 100 + $index,
			'url'          => 'https://wordpress.example.com/uploads/' . $asset['filename'],
			'mimeType'     => $asset['mimeType'],
			'disposition'  => 'reused',
		);
	}
	update_option(
		SiteForge_Runtime_V3_Assets::PREPARATIONS_OPTION,
		array(
			$preparation_id => array(
				'contractVersion' => 3,
				'preparationId'   => $preparation_id,
				'identity'        => $release['identity'],
				'idempotencyKey'  => $asset_request['idempotencyKey'],
				'assets'          => $assets,
				'preparedAt'      => '2026-08-04T20:01:00.000Z',
			),
		),
		false
	);
}

function siteforge_v3_deployment_request( $release, $preparation_id, $expected_hash ) {
	return array(
		'contractVersion'           => 3,
		'release'                   => $release,
		'assetPreparationId'        => $preparation_id,
		'expectedRemoteContentHash' => $expected_hash,
		'idempotencyKey'            => SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 3,
				'scope'                     => 'deployment',
				'identity'                  => $release['identity'],
				'expectedRemoteContentHash' => $expected_hash,
			)
		),
	);
}

siteforge_test(
	'asset fixture validates canonical identities',
	static function () {
		$parsed = SiteForge_Runtime_Validation::asset_request( siteforge_fixture( 'asset-preparation-request' ) );
		siteforge_assert( 2 === $parsed['contractVersion'], 'Wrong contract version.' );
		siteforge_assert( 1 === count( $parsed['assets'] ), 'Asset was not retained.' );
		siteforge_assert(
			'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' === $parsed['assets'][0]['byteHash'],
			'Byte hash was not retained.'
		);
	}
);

siteforge_test(
	'asset byte identity tampering is rejected',
	static function () {
		$fixture = siteforge_fixture( 'asset-preparation-request' );
		$fixture['assets'][0]['bytes'] = 1235;
		try {
			SiteForge_Runtime_Validation::asset_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'siteforge_asset_manifest_hash_mismatch' === $error->get_siteforge_code(),
				'Wrong asset mismatch error.'
			);
			return;
		}
		throw new RuntimeException( 'Tampered asset identity was accepted.' );
	}
);

siteforge_test(
	'deployment fixture validates operation and plan hashes',
	static function () {
		$parsed = SiteForge_Runtime_Validation::deployment_request( siteforge_fixture( 'deployment-request' ) );
		siteforge_assert(
			'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' === $parsed['artifactContentHash'],
			'Artifact content hash was not retained.'
		);
		siteforge_assert( 1 === count( $parsed['plan']['pages'] ), 'Pages were not retained.' );
	}
);

siteforge_test(
	'strict optional runtime state and block capabilities validate',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$state   = siteforge_fixture( 'runtime-plan-state' );
		foreach ( $state as $key => $value ) {
			$fixture['plan'][ $key ] = $value;
		}
		$fixture['plan']['pages'][0]['sections'][0] = siteforge_fixture( 'runtime-parity-section' );
		$fixture['operationHash'] = SiteForge_Runtime_Validation::hash( $fixture['plan'] );
		$fixture['idempotencyKey'] = SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'          => 2,
				'scope'                    => 'deployment',
				'siteId'                   => $fixture['siteId'],
				'artifactId'               => $fixture['artifactId'],
				'artifactContentHash'      => $fixture['artifactContentHash'],
				'expectedRemoteContentHash'=> $fixture['expectedRemoteContentHash'],
				'payloadHash'              => $fixture['operationHash'],
			)
		);
		$parsed = SiteForge_Runtime_Validation::deployment_request( $fixture );
		siteforge_assert( 'password_noindex' === $parsed['plan']['protection']['mode'], 'Protection state was not retained.' );
		siteforge_assert( array( 'editorial-copy', 'theme-dark' ) === $parsed['plan']['pages'][0]['sections'][0]['cssClasses'], 'CSS classes were not retained.' );
		siteforge_assert( 'section:hero' === $parsed['plan']['pages'][0]['sections'][0]['anchor'], 'Section anchor was not retained.' );
		siteforge_assert( 'wide' === $parsed['plan']['pages'][0]['sections'][0]['align'], 'Block alignment was not retained.' );
	}
);

siteforge_test(
	'unsupported block variants reject before mutation',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['pages'][0]['sections'][0]['variant'] = 'invented-layout';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.pages[0].sections[0].variant' === $error->get_details()['path'],
				'Wrong unsupported-variant path.'
			);
			return;
		}
		throw new RuntimeException( 'Unsupported block variant was accepted.' );
	}
);

siteforge_test(
	'full site configuration rejects unknown state',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$state   = siteforge_fixture( 'runtime-plan-state' );
		foreach ( $state as $key => $value ) {
			$fixture['plan'][ $key ] = $value;
		}
		$fixture['plan']['siteConfiguration']['unexpected'] = true;
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.siteConfiguration.unexpected' === $error->get_details()['path'],
				'Wrong strict site-configuration path.'
			);
			return;
		}
		throw new RuntimeException( 'Unknown site-configuration state was accepted.' );
	}
);

siteforge_test(
	'SEO requires root-relative canonical paths and valid JSON-LD',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['pages'][0]['seo'] = array(
			'title'          => 'Home',
			'description'    => 'Welcome home',
			'canonicalPath'  => '/',
			'noIndex'        => false,
			'structuredData' => array( '{"@context":"https://schema.org","@type":"WebPage"}' ),
		);
		$fixture['plan']['pages'][0]['seo']['structuredData'][0] = 'not-json';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.pages[0].seo.structuredData[0]' === $error->get_details()['path'],
				'Wrong JSON-LD validation path.'
			);
			return;
		}
		throw new RuntimeException( 'Malformed JSON-LD was accepted.' );
	}
);

siteforge_test(
	'navigation cycles reject before mutation',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['navigation']['items'][0]['parentItemKey'] = 'nav:home';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.navigation.items[0].parentItemKey' === $error->get_details()['path'],
				'Wrong navigation-cycle path.'
			);
			return;
		}
		throw new RuntimeException( 'Cyclic navigation was accepted.' );
	}
);

siteforge_test(
	'operation payload tampering is rejected',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['siteSettings']['siteName'] = 'Tampered';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'siteforge_operation_hash_mismatch' === $error->get_siteforge_code(),
				'Wrong operation mismatch error.'
			);
			return;
		}
		throw new RuntimeException( 'Tampered operation was accepted.' );
	}
);

siteforge_test(
	'string contract versions are rejected',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['contractVersion'] = '2';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'contractVersion' === $error->get_details()['path'], 'Wrong contract-version path.' );
			return;
		}
		throw new RuntimeException( 'String contractVersion was accepted.' );
	}
);

siteforge_test(
	'direct desired-state fields are required',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		unset( $fixture['plan']['navigation'] );
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'plan.navigation' === $error->get_details()['path'], 'Wrong required-field path.' );
			return;
		}
		throw new RuntimeException( 'Incomplete desired-state plan was accepted.' );
	}
);

siteforge_test(
	'unknown contract fields are rejected',
	static function () {
		$fixture = siteforge_fixture( 'asset-preparation-request' );
		$fixture['legacyArtifactHash'] = str_repeat( 'a', 64 );
		try {
			SiteForge_Runtime_Validation::asset_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'body.legacyArtifactHash' === $error->get_details()['path'], 'Wrong unknown-field path.' );
			return;
		}
		throw new RuntimeException( 'Unknown legacy field was accepted.' );
	}
);

foreach (
	array(
		'health'                  => 'health',
		'capabilities'            => 'capabilities',
		'asset-preparation-result'=> 'asset-preparation-result',
		'state'                   => 'state',
		'deployment-succeeded'    => 'deployment-status',
		'stale-remote-error'      => 'error',
	) as $fixture_name => $kind
) {
	siteforge_test(
		$fixture_name . ' shared response fixture validates',
		static function () use ( $fixture_name, $kind ) {
			$parsed = SiteForge_Runtime_Validation::response_fixture( $kind, siteforge_fixture( $fixture_name ) );
			siteforge_assert( 2 === $parsed['contractVersion'], 'Response fixture contractVersion is not integer 2.' );
		}
	);
}

siteforge_test(
	'response fixtures reject stale aliases',
	static function () {
		$fixture = siteforge_fixture( 'state' );
		$fixture['remoteContentHash'] = $fixture['artifactContentHash'];
		try {
			SiteForge_Runtime_Validation::response_fixture( 'state', $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'state.remoteContentHash' === $error->get_details()['path'], 'Wrong stale-alias path.' );
			return;
		}
		throw new RuntimeException( 'Stale response alias was accepted.' );
	}
);

siteforge_test(
	'v3 shared release and capabilities fixtures retain exact identities',
	static function () {
		$release      = SiteForge_Runtime_V3_Validation::release( siteforge_v3_fixture( 'release' ) );
		$capabilities = siteforge_v3_fixture( 'capabilities' );
		$empty_state  = siteforge_v3_fixture( 'empty-state' );
		$projection   = siteforge_v3_fixture( 'projection-v2' );
		siteforge_assert( 3 === $release['contractVersion'], 'V3 release contract version changed.' );
		foreach ( array( 'pages', 'sections', 'globalComponents', 'chrome', 'forms', 'redirects', 'responsiveRules', 'accessibilityAnnotations', 'seo', 'legal', 'analytics', 'integrations', 'assets', 'removals' ) as $resource_name ) {
			siteforge_assert( array_key_exists( $resource_name, $release['resourceGraph'] ), 'V3 resource graph fixture is missing ' . $resource_name . '.' );
		}
		siteforge_assert( 'runtime_plugin' === $release['identity']['runtimePackage']['packageType'], 'Runtime package identity was not retained.' );
		siteforge_assert( 3 === $capabilities['contractVersion'], 'V3 capabilities contract version changed.' );
		siteforge_assert( true === $capabilities['features']['completeResourceGraph'], 'V3 complete-resource capability changed.' );
		siteforge_assert( true === $capabilities['features']['exactPackageIdentity'], 'V3 package-identity capability changed.' );
		siteforge_assert( array_keys( $empty_state ) === array_keys( ( new SiteForge_Runtime_V3_State() )->empty_state( 'site-1' ) ), 'V3 empty-state endpoint shape changed.' );
		siteforge_assert( 3 === $projection['contractVersion'] && 2 === $projection['projection']['contractVersion'], 'V3 projection endpoint shape changed.' );
	}
);

siteforge_test(
	'v3 malformed and unknown fields fail closed before mutation',
	static function () {
		$unknown = siteforge_v3_fixture( 'release' );
		$unknown['resourceGraph']['pages'][0]['futureField'] = true;
		try {
			SiteForge_Runtime_V3_Validation::release( $unknown );
			throw new RuntimeException( 'V3 unknown field was accepted.' );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'release.resourceGraph.pages[0].futureField' === $error->get_details()['path'], 'Wrong v3 unknown-field path.' );
		}

		$missing = siteforge_v3_fixture( 'release' );
		$missing['resourceGraph']['pages'][0]['sectionIds'] = array( 'section:missing' );
		$missing['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $missing['resourceGraph'] );
		try {
			SiteForge_Runtime_V3_Validation::release( $missing );
			throw new RuntimeException( 'V3 missing resource reference was accepted.' );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'release.resourceGraph.pages[0].sectionIds' === $error->get_details()['path'], 'Wrong v3 graph-reference path.' );
		}

		$partial_assets = siteforge_v3_asset_request( siteforge_v3_fixture( 'release' ) );
		$partial_assets['assets'] = array();
		try {
			SiteForge_Runtime_V3_Validation::asset_request( $partial_assets );
			throw new RuntimeException( 'Partial v3 asset preparation was accepted.' );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'body.assets' === $error->get_details()['path'], 'Wrong v3 asset-manifest path.' );
		}
	}
);

siteforge_test(
	'v3 apply readback and strict v2 projection remain exact',
	static function () {
		siteforge_v3_reset_options();
		$release        = siteforge_v3_fixture( 'release' );
		$preparation_id = 'preparation:fixture-v3';
		siteforge_v3_store_preparation( $release, $preparation_id );
		$state        = new SiteForge_Runtime_V3_State();
		$assets       = new SiteForge_Runtime_V3_Assets( new SiteForge_Runtime_Assets() );
		$transactions = new SiteForge_Runtime_V3_Transactions( $state, $assets );
		$status       = $transactions->apply( siteforge_v3_deployment_request( $release, $preparation_id, null ) );
		$readback     = $state->read( $release['identity']['siteId'] );
		$projection   = $state->projection();

		siteforge_assert( 'succeeded' === $status['status'] && 'complete' === $status['phase'], 'V3 deployment did not complete.' );
		siteforge_assert( true === $status['verification']['verified'], 'V3 deployment readback was not verified.' );
		siteforge_assert( $release['identity'] === $readback['identity'], 'V3 state lost exact release identities.' );
		siteforge_assert( 2 === $projection['contractVersion'], 'V3 state did not produce a v2 projection.' );
		siteforge_assert( $release['identity']['artifactContentHash'] === $projection['artifactContentHash'], 'V2 projection changed artifact identity.' );
		siteforge_assert( $release['identity']['operationSetHash'] === $projection['operationHash'], 'V2 projection changed operation identity.' );
	}
);

siteforge_test(
	'v3 failed apply performs compensating rollback to verified state',
	static function () {
		global $siteforge_test_fail_resource;
		siteforge_v3_reset_options();
		$state        = new SiteForge_Runtime_V3_State();
		$assets       = new SiteForge_Runtime_V3_Assets( new SiteForge_Runtime_Assets() );
		$transactions = new SiteForge_Runtime_V3_Transactions( $state, $assets );
		$first        = siteforge_v3_fixture( 'release' );
		siteforge_v3_store_preparation( $first, 'preparation:first-v3' );
		$transactions->apply( siteforge_v3_deployment_request( $first, 'preparation:first-v3', null ) );

		$second = siteforge_v3_fixture( 'release' );
		$second['identity']['artifactId']          = '99999999-9999-4999-8999-999999999999';
		$second['identity']['artifactContentHash'] = str_repeat( 'e', 64 );
		$second['resourceGraph']['pages'][0]['title'] = 'Candidate title';
		$second['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $second['resourceGraph'] );
		siteforge_v3_store_preparation( $second, 'preparation:second-v3' );
		$siteforge_test_fail_resource = 'sections';
		try {
			$transactions->apply(
				siteforge_v3_deployment_request(
					$second,
					'preparation:second-v3',
					$first['identity']['artifactContentHash']
				)
			);
			throw new RuntimeException( 'Injected v3 resource failure did not fail.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			$details = $error->get_details();
			siteforge_assert( true === $details['rollback']['succeeded'], 'V3 compensating rollback did not succeed.' );
		}
		$siteforge_test_fail_resource = null;
		$readback = $state->read( $first['identity']['siteId'] );
		siteforge_assert( $first['identity']['artifactContentHash'] === $readback['identity']['artifactContentHash'], 'Failed v3 candidate replaced active state.' );
		siteforge_assert( true === $state->verify()['verified'], 'Compensated v3 state failed readback verification.' );
	}
);

siteforge_test(
	'canonical hashing is independent of object key order',
	static function () {
		$left  = array( 'z' => 1, 'a' => array( 'y' => true, 'b' => 'value' ) );
		$right = array( 'a' => array( 'b' => 'value', 'y' => true ), 'z' => 1 );
		siteforge_assert(
			SiteForge_Runtime_Validation::hash( $left ) === SiteForge_Runtime_Validation::hash( $right ),
			'Canonical hashes differ.'
		);
	}
);

siteforge_test(
	'v1 compatibility fixtures remain readable',
	static function () {
		foreach ( array( 'deployment.json', 'asset-preparation.json' ) as $name ) {
			$path = __DIR__ . '/fixtures/' . $name;
			siteforge_assert( is_array( json_decode( file_get_contents( $path ), true ) ), 'Could not decode ' . $name );
		}
	}
);

siteforge_test(
	'runtime and theme source enforce parity safety invariants',
	static function () {
		$plugin_root = dirname( __DIR__ );
		$repo_root   = dirname( $plugin_root, 2 );
		$theme_root  = $repo_root . '/wordpress-theme/oneclick-siteforge';
		$transactions = file_get_contents( $plugin_root . '/includes/class-siteforge-runtime-transactions.php' );
		$assets       = file_get_contents( $plugin_root . '/includes/class-siteforge-runtime-assets.php' );
		$header       = file_get_contents( $theme_root . '/header.php' );
		$utilities    = file_get_contents( $theme_root . '/inc/block-utilities.php' );
		$behavior     = file_get_contents( $theme_root . '/assets/js/site-behavior.js' );
		$functions    = file_get_contents( $theme_root . '/functions.php' );

		siteforge_assert( false === strpos( $transactions, "get_page_by_path( 'sample-page'" ), 'Transactions still delete the unmanaged sample page.' );
		siteforge_assert( false !== strpos( $transactions, 'rollback_preparation' ), 'Asset rollback is not wired into transactions.' );
		siteforge_assert( false !== strpos( $assets, 'PREPARATION_EFFECTS_OPTION' ), 'Asset compensation effects are not tracked.' );
		siteforge_assert( false !== strpos( $transactions, 'SEO_TITLE_META' ), 'SiteForge SEO is not canonical in transactions.' );
		siteforge_assert( false !== strpos( $header, 'wp_nav_menu' ) && false !== strpos( $header, "'depth'          => 0" ), 'Header does not render the complete canonical WordPress menu.' );
		siteforge_assert( false === strpos( $utilities, "\$GLOBALS['block']" ), 'Block rendering still relies on a broken global.' );
		siteforge_assert( false !== strpos( $behavior, 'siteforge-back-to-top' ) && false !== strpos( $behavior, 'informational' ) && false !== strpos( $behavior, 'prefers-reduced-motion' ), 'Accepted behavior fields are not implemented.' );
		siteforge_assert( false !== strpos( $functions, '_siteforge_seo_title' ) && false !== strpos( $functions, 'wpseo_frontend_presenters' ), 'Theme SEO still depends on Yoast canonical storage.' );

		foreach ( glob( $theme_root . '/blocks/*.php' ) as $block_file ) {
			$source = file_get_contents( $block_file );
			if ( false !== strpos( $source, 'oneclick_get_block_wrapper_attributes(' ) ) {
				siteforge_assert( false !== strpos( $source, 'oneclick_get_block_wrapper_attributes( $block,' ), basename( $block_file ) . ' does not pass its local ACF block.' );
			}
		}
	}
);

if ( $failures > 0 ) {
	exit( 1 );
}

fwrite( STDOUT, "All SiteForge runtime contract tests passed.\n" );

