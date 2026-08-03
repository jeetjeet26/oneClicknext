<?php
/**
 * Focused dependency-free contract tests.
 */

require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-validation.php';

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

function siteforge_assert( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
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

if ( $failures > 0 ) {
	exit( 1 );
}

fwrite( STDOUT, "All SiteForge runtime contract tests passed.\n" );

