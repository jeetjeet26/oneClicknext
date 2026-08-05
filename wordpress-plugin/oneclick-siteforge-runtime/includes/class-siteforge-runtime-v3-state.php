<?php
/**
 * Persistent SiteForge v3 state and v2 downgrade projection.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_V3_State {
	const ACTIVE_OPTION        = 'oneclick_siteforge_runtime_state_v3';
	const V2_PROJECTION_OPTION = 'oneclick_siteforge_runtime_v2_projection_v3';
	const RESOURCE_PREFIX      = 'oneclick_siteforge_runtime_resource_v3_';

	/**
	 * Resource names are deliberately closed. A v3 deployment is a complete
	 * desired-state graph, not an open-ended bag of WordPress options.
	 */
	const RESOURCE_NAMES = array(
		'graphVersion',
		'homepagePageId',
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
		'target',
	);

	public function empty_state( $site_id = '' ) {
		return array(
			'contractVersion' => 3,
			'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
			'siteId'          => $site_id,
			'identity'        => null,
			'transactionId'   => null,
			'target'          => null,
			'resourceHashes'  => (object) array(),
			'mediaBindings'   => (object) array(),
			'v2Projection'    => null,
			'updatedAt'       => null,
		);
	}

	public function read( $site_id = '' ) {
		$state = get_option( self::ACTIVE_OPTION, array() );
		if ( ! is_array( $state ) || empty( $state['identity']['artifactContentHash'] ) ) {
			return $this->empty_state( $site_id );
		}
		if ( '' !== $site_id && isset( $state['siteId'] ) && $site_id !== $state['siteId'] ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_v3_site_identity_conflict',
				'This WordPress runtime is already bound to a different SiteForge site.',
				409,
				array(
					'requestedSiteId' => $site_id,
					'activeSiteId'    => $state['siteId'],
				)
			);
		}
		$verification          = $this->verify( $state );
		$state['verification'] = $verification;
		if ( ! $verification['verified'] ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_v3_remote_state_drift',
				'WordPress no longer matches the active SiteForge v3 resource graph.',
				409,
				array( 'checks' => $verification['checks'] )
			);
		}
		return $this->public_state( $state );
	}

	public function active_content_hash() {
		$state = get_option( self::ACTIVE_OPTION, array() );
		return is_array( $state ) && SiteForge_Runtime_Validation::is_hash( isset( $state['identity']['artifactContentHash'] ) ? $state['identity']['artifactContentHash'] : null )
			? $state['identity']['artifactContentHash']
			: null;
	}

	public function snapshot() {
		$options = array();
		foreach ( $this->managed_options() as $option ) {
			$sentinel = '__siteforge_v3_missing_' . $this->uuid();
			$value    = get_option( $option, $sentinel );
			$options[ $option ] = array(
				'exists' => $sentinel !== $value,
				'value'  => $sentinel !== $value ? $value : null,
			);
		}
		return array( 'options' => $options );
	}

	public function restore( $snapshot ) {
		if ( ! is_array( $snapshot ) || ! isset( $snapshot['options'] ) || ! is_array( $snapshot['options'] ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_snapshot_invalid', 'The v3 rollback snapshot is invalid.', 500 );
		}
		foreach ( $snapshot['options'] as $option => $saved ) {
			if ( ! in_array( $option, $this->managed_options(), true ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_snapshot_invalid', 'The v3 rollback snapshot contains an unmanaged option.', 500 );
			}
			if ( ! empty( $saved['exists'] ) ) {
				$this->write_option( $option, $saved['value'], 'rollback' );
			} else {
				delete_option( $option );
			}
		}
		$this->assert_snapshot( $snapshot );
	}

	public function apply_resources( $resources ) {
		foreach ( self::RESOURCE_NAMES as $name ) {
			if ( ! array_key_exists( $name, $resources ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_v3_resource_incomplete',
					'The complete v3 resource graph is missing ' . $name . '.',
					422,
					array( 'resource' => $name )
				);
			}
			$this->write_option( self::RESOURCE_PREFIX . $name, $resources[ $name ], 'resource ' . $name );
			if ( function_exists( 'apply_filters' ) ) {
				$accepted = apply_filters( 'oneclick_siteforge_runtime_v3_resource_applied', true, $name, $resources[ $name ] );
				if ( false === $accepted || ( function_exists( 'is_wp_error' ) && is_wp_error( $accepted ) ) ) {
					throw new SiteForge_Runtime_Exception(
						'siteforge_v3_resource_apply_failed',
						'WordPress rejected v3 resource ' . $name . '.',
						500,
						array( 'resource' => $name )
					);
				}
			}
		}
	}

	public function commit( $state, $projection ) {
		$this->assert_v2_projection( $projection );
		$this->write_option( self::V2_PROJECTION_OPTION, $projection, 'v2 downgrade projection' );
		$this->write_option( self::ACTIVE_OPTION, $state, 'active manifest' );
	}

	public function verify( $state = null ) {
		$state = null === $state ? get_option( self::ACTIVE_OPTION, array() ) : $state;
		if ( ! is_array( $state ) || empty( $state['identity']['artifactContentHash'] ) ) {
			return array(
				'verified'             => true,
				'resourceGraphHash'    => null,
				'packageManifestSha256'=> null,
				'checks'               => array(),
				'verifiedAt'           => gmdate( 'c' ),
			);
		}
		$checks    = array();
		$resources = array();
		foreach ( self::RESOURCE_NAMES as $name ) {
			$actual      = get_option( self::RESOURCE_PREFIX . $name, null );
			$resources[ $name ] = $actual;
			$expected_hash = isset( $state['optionHashes'][ $name ] ) ? $state['optionHashes'][ $name ] : null;
			$actual_hash   = SiteForge_Runtime_Validation::hash( $actual );
			$passed        = SiteForge_Runtime_Validation::is_hash( $expected_hash ) && hash_equals( $expected_hash, $actual_hash );
			$checks[]      = $this->check( 'resource:' . $name, $passed, $passed ? 'Resource matches.' : 'Resource hash mismatch.' );
		}
		$target = $resources['target'];
		unset( $resources['target'] );
		$graph_hash = SiteForge_Runtime_Validation::hash( $resources );
		$graph_ok   = isset( $state['identity']['resourceGraphHash'] ) && hash_equals( $state['identity']['resourceGraphHash'], $graph_hash );
		$checks[]   = $this->check( 'resource_graph', $graph_ok, $graph_ok ? 'Resource graph matches.' : 'Resource graph hash mismatch.' );
		$target_ok  = isset( $state['targetHash'] ) && hash_equals( $state['targetHash'], SiteForge_Runtime_Validation::hash( $target ) );
		$checks[]   = $this->check( 'target', $target_ok, $target_ok ? 'Target matches.' : 'Target hash mismatch.' );

		$projection    = get_option( self::V2_PROJECTION_OPTION, array() );
		$projection_ok = is_array( $projection ) && isset( $state['v2ProjectionHash'] ) &&
			hash_equals( (string) $state['v2ProjectionHash'], SiteForge_Runtime_Validation::hash( $projection ) );
		$checks[]      = $this->check( 'v2_projection', $projection_ok, $projection_ok ? 'Downgrade projection matches.' : 'Downgrade projection mismatch.' );

		$verified = true;
		foreach ( $checks as $check ) {
			if ( ! $check['passed'] ) {
				$verified = false;
				break;
			}
		}
		return array(
			'verified'              => $verified,
			'resourceGraphHash'     => $verified ? $graph_hash : null,
			'packageManifestSha256' => $verified ? $state['identity']['runtimePackage']['manifestSha256'] : null,
			'checks'                => $checks,
			'verifiedAt'            => gmdate( 'c' ),
		);
	}

	public function projection() {
		$projection = get_option( self::V2_PROJECTION_OPTION, null );
		if ( null === $projection ) {
			return null;
		}
		$this->assert_v2_projection( $projection );
		return $projection;
	}

	public function projection_for( $input, $transaction_id, $updated_at ) {
		$projection = array(
			'contractVersion'     => 2,
			'siteId'              => $input['siteId'],
			'artifactId'          => $input['artifactId'],
			'artifactContentHash' => $input['artifactContentHash'],
			'assetManifestHash'   => $input['assetManifestHash'],
			'operationHash'       => $input['operationHash'],
			'stateHash'           => SiteForge_Runtime_Validation::hash(
				array(
					'siteId'                   => $input['siteId'],
					'artifactContentHash'      => $input['artifactContentHash'],
					'resourceGraphHash'        => $input['resourceHash'],
					'transactionId'            => $transaction_id,
					'updatedAt'                => $updated_at,
				)
			),
		);
		$this->assert_v2_projection( $projection );
		return $projection;
	}

	private function public_state( $state ) {
		return array(
			'contractVersion' => 3,
			'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
			'siteId'          => $state['siteId'],
			'identity'        => $state['identity'],
			'transactionId'   => $state['transactionId'],
			'target'          => $state['target'],
			'resourceHashes'  => empty( $state['resourceHashes'] ) ? (object) array() : $state['resourceHashes'],
			'mediaBindings'   => empty( $state['mediaBindings'] ) ? (object) array() : $state['mediaBindings'],
			'v2Projection'    => $this->projection(),
			'updatedAt'       => $state['updatedAt'],
		);
	}

	private function assert_v2_projection( $projection ) {
		$keys = array( 'contractVersion', 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'operationHash', 'stateHash' );
		if ( ! is_array( $projection ) || array() !== array_diff( array_keys( $projection ), $keys ) || array() !== array_diff( $keys, array_keys( $projection ) ) || 2 !== $projection['contractVersion'] ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_v2_projection_invalid', 'The v3 deployment cannot produce a strict v2 downgrade projection.', 500 );
		}
		if ( ! preg_match( SiteForge_Runtime_Validation::UUID_PATTERN, $projection['artifactId'] ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_v2_projection_invalid', 'The v2 projection artifact identity is invalid.', 500 );
		}
		foreach ( array( 'artifactContentHash', 'assetManifestHash', 'operationHash', 'stateHash' ) as $hash ) {
			if ( ! SiteForge_Runtime_Validation::is_hash( $projection[ $hash ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_v2_projection_invalid', 'The v2 projection hashes are invalid.', 500 );
			}
		}
	}

	private function assert_snapshot( $snapshot ) {
		foreach ( $snapshot['options'] as $option => $saved ) {
			$sentinel = '__siteforge_v3_rollback_missing_' . $this->uuid();
			$actual   = get_option( $option, $sentinel );
			$exists   = $sentinel !== $actual;
			if ( (bool) $saved['exists'] !== $exists || ( $exists && $actual !== $saved['value'] ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_v3_rollback_readback_failed',
					'SiteForge v3 rollback readback failed.',
					500,
					array( 'option' => $option )
				);
			}
		}
	}

	private function managed_options() {
		$options = array( self::ACTIVE_OPTION, self::V2_PROJECTION_OPTION );
		foreach ( self::RESOURCE_NAMES as $name ) {
			$options[] = self::RESOURCE_PREFIX . $name;
		}
		return $options;
	}

	private function write_option( $option, $value, $label ) {
		$result = update_option( $option, $value, false );
		if ( false === $result && $value !== get_option( $option, null ) ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_v3_state_write_failed',
				'Could not persist SiteForge v3 ' . $label . '.',
				500,
				array( 'option' => $option )
			);
		}
	}

	private function check( $name, $passed, $message ) {
		return array(
			'name'    => $name,
			'passed'  => (bool) $passed,
			'message' => $message,
		);
	}

	private function uuid() {
		return function_exists( 'wp_generate_uuid4' )
			? wp_generate_uuid4()
			: uniqid( 'siteforge-v3-', true );
	}
}
