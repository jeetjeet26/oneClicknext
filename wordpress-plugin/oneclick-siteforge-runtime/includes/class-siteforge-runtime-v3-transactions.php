<?php
/**
 * SiteForge v3 complete-resource transactions and compensating rollback.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_V3_Transactions {
	const TRANSACTIONS_OPTION = 'oneclick_siteforge_runtime_transactions_v3';
	const IDEMPOTENCY_OPTION  = 'oneclick_siteforge_runtime_idempotency_v3';
	const LOCK_OPTION         = 'oneclick_siteforge_runtime_deployment_lock_v3';

	/** @var SiteForge_Runtime_V3_State */
	private $state;

	/** @var SiteForge_Runtime_V3_Assets */
	private $assets;

	public function __construct( SiteForge_Runtime_V3_State $state, SiteForge_Runtime_V3_Assets $assets ) {
		$this->state  = $state;
		$this->assets = $assets;
	}

	public function apply( $request ) {
		$input = SiteForge_Runtime_V3_Validation::deployment_request( $request );
		$this->assert_preparation( $input );
		$prior = $this->lookup_idempotency( $input );
		if ( null !== $prior ) {
			$prior['idempotentReplay'] = true;
			return $this->public_status( $prior );
		}

		$lock_token     = $this->acquire_lock();
		$transaction_id = $this->uuid();
		$started_at     = gmdate( 'c' );
		$previous_hash  = $this->state->active_content_hash();
		$snapshot       = null;
		$status         = array(
			'contractVersion'           => 3,
			'transactionId'             => $transaction_id,
			'status'                    => 'running',
			'phase'                     => 'preflight',
			'identity'                  => $input['packageIdentities'],
			'idempotencyKey'            => $input['idempotencyKey'],
			'expectedRemoteContentHash' => $input['expectedRemoteContentHash'],
			'previousRemoteContentHash' => $previous_hash,
			'appliedContentHash'        => null,
			'runtimeVersion'            => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
			'resourceIds'               => (object) array(),
			'mediaBindings'             => (object) array(),
			'v2Projection'              => null,
			'rollback'                  => $this->empty_rollback(),
			'verification'              => null,
			'submittedAt'               => $started_at,
			'startedAt'                 => $started_at,
			'completedAt'               => null,
			'idempotentReplay'          => false,
			'failure'                    => null,
			'_assetPreparationId'        => $input['assetPreparationId'],
		);

		try {
			$this->assert_expected_hash( $input['expectedRemoteContentHash'], $previous_hash );
			$this->assert_site_identity( $input['siteId'] );
			$snapshot            = $this->state->snapshot();
			$status['_snapshot'] = $snapshot;
			$this->store_transaction( $status );
			$this->store_idempotency( $input, $transaction_id );

			$status['phase'] = 'package_verification';
			$this->store_transaction( $status );
			$this->assert_package_identity( $input['packageIdentities'] );

			$status['phase'] = 'transaction';
			$this->store_transaction( $status );
			$this->state->apply_resources( $input['resources'] );

			$status['phase'] = 'verification';
			$this->store_transaction( $status );
			$option_hashes = array();
			foreach ( SiteForge_Runtime_V3_State::RESOURCE_NAMES as $name ) {
				$option_hashes[ $name ] = SiteForge_Runtime_Validation::hash( $input['resources'][ $name ] );
			}
			$resource_hashes = $this->resource_hashes( $input['release']['resourceGraph'] );
			$resource_ids    = $this->resource_ids( $resource_hashes );
			$media_bindings  = $this->media_bindings( $input['assetPreparationId'] );
			$updated_at      = gmdate( 'c' );
			$projection      = $this->state->projection_for( $input, $transaction_id, $updated_at );
			$manifest        = array(
				'contractVersion'     => 3,
				'runtimeVersion'      => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
				'siteId'              => $input['siteId'],
				'identity'            => $input['packageIdentities'],
				'transactionId'       => $transaction_id,
				'target'              => $input['release']['target'],
				'resourceHashes'      => $resource_hashes,
				'mediaBindings'       => $media_bindings,
				'optionHashes'        => $option_hashes,
				'targetHash'          => SiteForge_Runtime_Validation::hash( $input['release']['target'] ),
				'v2ProjectionHash'    => SiteForge_Runtime_Validation::hash( $projection ),
				'updatedAt'           => $updated_at,
			);

			$status['phase'] = 'v2_projection';
			$this->store_transaction( $status );
			// Final desired-state write: failed candidates never become active.
			$this->state->commit( $manifest, $projection );
			$verification = $this->state->verify( $manifest );
			if ( ! $verification['verified'] ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_verification_failed', 'V3 resource readback did not match the exact release.', 500, array( 'checks' => $verification['checks'] ) );
			}

			$status['status']             = 'succeeded';
			$status['phase']              = 'complete';
			$status['appliedContentHash'] = $input['artifactContentHash'];
			$status['resourceIds']        = empty( $resource_ids ) ? (object) array() : $resource_ids;
			$status['mediaBindings']      = empty( $media_bindings ) ? (object) array() : $media_bindings;
			$status['v2Projection']       = $projection;
			$status['verification']       = $verification;
			$status['completedAt']        = gmdate( 'c' );
			$this->store_transaction( $status );
			return $this->public_status( $status );
		} catch ( Throwable $error ) {
			$status['status']                = 'failed';
			$status['completedAt']           = gmdate( 'c' );
			$status['rollback']['attempted'] = true;
			try {
				if ( null !== $snapshot ) {
					$this->state->restore( $snapshot );
				}
				$this->assets->rollback_preparation( $input['assetPreparationId'], $input['artifactId'] );
				$status['rollback']['succeeded']                    = true;
				$status['rollback']['restoredArtifactContentHash'] = $previous_hash;
				$status['rollback']['restoredResourceGraphHash']   = $this->snapshot_graph_hash( $snapshot );
			} catch ( Throwable $rollback_error ) {
				$status['rollback']['succeeded'] = false;
				$status['rollback']['failure']   = $this->failure( $rollback_error, 'rollback' );
			}
			$status['failure'] = $this->failure( $error, $status['phase'] );
			$this->store_transaction( $status );
			$this->rethrow( $error, $transaction_id, $status );
		} finally {
			$this->release_lock( $lock_token );
		}
	}

	public function rollback( $request ) {
		$input      = SiteForge_Runtime_V3_Validation::rollback_request( $request );
		$lock_token = $this->acquire_lock();
		try {
			$status = $this->internal_status( strtolower( $input['transactionId'] ) );
			if ( null === $status ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_deployment_not_found', 'No SiteForge v3 deployment exists for that transaction ID.', 404 );
			}
			if ( 'succeeded' !== $status['status'] || empty( $status['_snapshot'] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_unavailable', 'Only a succeeded v3 transaction with a retained snapshot can be rolled back.', 409 );
			}
			if ( $input['siteId'] !== $status['identity']['siteId'] ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_identity_conflict', 'Rollback site identity does not own this transaction.', 409 );
			}
			$restore_hash = $this->snapshot_content_hash( $status['_snapshot'] );
			$restore_graph= $this->snapshot_graph_hash( $status['_snapshot'] );
			if ( $input['restoreArtifactContentHash'] !== $restore_hash || $input['restoreResourceGraphHash'] !== $restore_graph ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_identity_conflict', 'Rollback restore identity does not match the retained snapshot.', 409 );
			}
			if ( ! empty( $status['rollback']['attempted'] ) ) {
				return $this->public_status( $status );
			}
			if ( $input['expectedCurrentContentHash'] !== $this->state->active_content_hash() ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_stale_remote_content_hash', 'Rollback expected content hash is stale.', 409 );
			}
			$status['phase']                 = 'rollback';
			$status['rollback']['attempted'] = true;
			$this->store_transaction( $status );
			try {
				$this->state->restore( $status['_snapshot'] );
				$this->assets->rollback_preparation( $status['_assetPreparationId'], $status['identity']['artifactId'] );
				$status['rollback']['succeeded']                    = true;
				$status['rollback']['restoredArtifactContentHash'] = $restore_hash;
				$status['rollback']['restoredResourceGraphHash']   = $restore_graph;
				// Keep the original successful deployment identity/status for the
				// strict response schema; rollback truth lives in rollback.
				$status['phase']       = 'complete';
				$status['completedAt'] = gmdate( 'c' );
			} catch ( Throwable $error ) {
				$status['rollback']['succeeded'] = false;
				$status['rollback']['failure']   = $this->failure( $error, 'rollback' );
				$status['status']                = 'failed';
				$status['failure']               = $status['rollback']['failure'];
				$status['completedAt']           = gmdate( 'c' );
			}
			$this->store_transaction( $status );
			return $this->public_status( $status );
		} finally {
			$this->release_lock( $lock_token );
		}
	}

	public function get_status( $transaction_id ) {
		$status = $this->internal_status( $transaction_id );
		return null === $status ? null : $this->public_status( $status );
	}

	private function assert_preparation( $input ) {
		$preparation = $this->assets->get_preparation( $input['assetPreparationId'] );
		if ( ! is_array( $preparation ) || ! isset( $preparation['identity'] ) || $preparation['identity'] !== $input['packageIdentities'] ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_asset_preparation_invalid', 'Deployment references a missing or mismatched exact v3 asset preparation.', 422 );
		}
		$expected_idempotency = SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 3,
				'scope'                     => 'asset_preparation',
				'identity'                  => $input['packageIdentities'],
				'expectedRemoteContentHash' => null,
			)
		);
		if (
			! isset( $preparation['contractVersion'], $preparation['preparationId'], $preparation['idempotencyKey'], $preparation['assets'] ) ||
			3 !== $preparation['contractVersion'] ||
			$input['assetPreparationId'] !== $preparation['preparationId'] ||
			$expected_idempotency !== $preparation['idempotencyKey']
		) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_asset_preparation_invalid', 'Deployment preparation metadata does not match the exact v3 release.', 422 );
		}
		$prepared = array();
		foreach ( $preparation['assets'] as $asset ) {
			if ( isset( $prepared[ $asset['assetId'] ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_asset_preparation_invalid', 'Prepared asset identities must be unique.', 422 );
			}
			$prepared[ $asset['assetId'] ] = $asset['byteSha256'];
		}
		if ( count( $prepared ) !== count( $input['assets'] ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_asset_preparation_invalid', 'Prepared assets must exactly match the complete v3 asset graph.', 422 );
		}
		foreach ( $input['assets'] as $asset ) {
			if ( ! isset( $prepared[ $asset['assetId'] ] ) || $prepared[ $asset['assetId'] ] !== $asset['byteSha256'] ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_asset_preparation_invalid', 'Prepared assets do not cover the complete v3 asset graph.', 422 );
			}
		}
	}

	private function assert_package_identity( $identity ) {
		foreach ( array_merge( array( $identity['runtimePackage'], $identity['baseTheme'] ), array_column( $identity['overlays'], 'package' ), array_column( $identity['extensions'], 'package' ) ) as $package ) {
			$actual = SiteForge_Runtime_Validation::hash( $package['manifest'] );
			if ( ! hash_equals( $package['manifestSha256'], $actual ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_manifest_hash_mismatch', 'Package manifest identity changed after validation.', 422 );
			}
		}
	}

	private function resource_hashes( $graph ) {
		$output = array();
		foreach ( array( 'pages', 'sections', 'globalComponents', 'forms', 'redirects', 'responsiveRules', 'accessibilityAnnotations', 'seo', 'legal', 'integrations', 'assets' ) as $collection ) {
			foreach ( $graph[ $collection ] as $resource ) {
				$output[ $resource['resourceId'] ] = $resource['contentHash'];
			}
		}
		$output[ $graph['chrome']['resourceId'] ]    = $graph['chrome']['contentHash'];
		$output[ $graph['analytics']['resourceId'] ] = $graph['analytics']['contentHash'];
		ksort( $output, SORT_STRING );
		return $output;
	}

	private function resource_ids( $hashes ) {
		$output = array();
		$index  = 1;
		foreach ( array_keys( $hashes ) as $resource_id ) {
			$output[ $resource_id ] = $index++;
		}
		return $output;
	}

	private function media_bindings( $preparation_id ) {
		$preparation = $this->assets->get_preparation( $preparation_id );
		$output      = array();
		foreach ( is_array( $preparation ) ? $preparation['assets'] : array() as $asset ) {
			$output[ $asset['assetId'] ] = array(
				'assetId'      => $asset['assetId'],
				'byteSha256'   => $asset['byteSha256'],
				'attachmentId' => $asset['attachmentId'],
				'url'          => $asset['url'],
				'mimeType'     => $asset['mimeType'],
				'disposition'  => $asset['disposition'],
			);
		}
		ksort( $output, SORT_STRING );
		return $output;
	}

	private function public_status( $status ) {
		unset( $status['_snapshot'] );
		unset( $status['_assetPreparationId'] );
		return $status;
	}

	private function internal_status( $transaction_id ) {
		$transactions = get_option( self::TRANSACTIONS_OPTION, array() );
		return is_array( $transactions ) && isset( $transactions[ $transaction_id ] ) ? $transactions[ $transaction_id ] : null;
	}

	private function lookup_idempotency( $input ) {
		$records = get_option( self::IDEMPOTENCY_OPTION, array() );
		$key     = hash( 'sha256', $input['idempotencyKey'] );
		if ( ! is_array( $records ) || ! isset( $records[ $key ] ) ) {
			return null;
		}
		$record = $records[ $key ];
		if ( $record['identity'] !== $input['packageIdentities'] || $record['expectedRemoteContentHash'] !== $input['expectedRemoteContentHash'] ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_idempotency_conflict', 'V3 idempotency key was already used for another exact identity.', 409 );
		}
		return $this->internal_status( $record['transactionId'] );
	}

	private function store_idempotency( $input, $transaction_id ) {
		$records = get_option( self::IDEMPOTENCY_OPTION, array() );
		$records = is_array( $records ) ? $records : array();
		$records[ hash( 'sha256', $input['idempotencyKey'] ) ] = array(
			'identity'                  => $input['packageIdentities'],
			'expectedRemoteContentHash' => $input['expectedRemoteContentHash'],
			'transactionId'             => $transaction_id,
			'createdAt'                 => gmdate( 'c' ),
		);
		update_option( self::IDEMPOTENCY_OPTION, $records, false );
	}

	private function store_transaction( $status ) {
		$records = get_option( self::TRANSACTIONS_OPTION, array() );
		$records = is_array( $records ) ? $records : array();
		$records[ $status['transactionId'] ] = $status;
		update_option( self::TRANSACTIONS_OPTION, $records, false );
	}

	private function assert_expected_hash( $expected, $actual ) {
		if ( $expected === $actual ) {
			return;
		}
		throw new SiteForge_Runtime_Exception( 'siteforge_v3_stale_remote_content_hash', 'WordPress remote content changed after this v3 deployment was compiled.', 409 );
	}

	private function assert_site_identity( $site_id ) {
		$active = get_option( SiteForge_Runtime_V3_State::ACTIVE_OPTION, array() );
		if ( is_array( $active ) && ! empty( $active['siteId'] ) && $site_id !== $active['siteId'] ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_site_identity_conflict', 'Runtime is bound to a different v3 site.', 409 );
		}
	}

	private function snapshot_content_hash( $snapshot ) {
		$active = isset( $snapshot['options'][ SiteForge_Runtime_V3_State::ACTIVE_OPTION ]['value'] ) ? $snapshot['options'][ SiteForge_Runtime_V3_State::ACTIVE_OPTION ]['value'] : null;
		return is_array( $active ) && isset( $active['identity']['artifactContentHash'] ) ? $active['identity']['artifactContentHash'] : null;
	}

	private function snapshot_graph_hash( $snapshot ) {
		$active = isset( $snapshot['options'][ SiteForge_Runtime_V3_State::ACTIVE_OPTION ]['value'] ) ? $snapshot['options'][ SiteForge_Runtime_V3_State::ACTIVE_OPTION ]['value'] : null;
		return is_array( $active ) && isset( $active['identity']['resourceGraphHash'] ) ? $active['identity']['resourceGraphHash'] : null;
	}

	private function empty_rollback() {
		return array(
			'attempted'                    => false,
			'succeeded'                    => null,
			'restoredArtifactContentHash'  => null,
			'restoredResourceGraphHash'    => null,
			'failure'                      => null,
		);
	}

	private function failure( $error, $phase ) {
		return array(
			'code'      => $error instanceof SiteForge_Runtime_Validation_Exception ? 'invalid_artifact' : 'operation_failed',
			'message'   => $error->getMessage(),
			'retryable' => false,
			'stage'     => in_array( $phase, array( 'package_verification', 'verification', 'v2_projection', 'rollback' ), true ) ? $phase : 'transaction',
			'details'   => $error instanceof SiteForge_Runtime_Exception || $error instanceof SiteForge_Runtime_Validation_Exception ? $error->get_details() : array(),
		);
	}

	private function rethrow( $error, $transaction_id, $status ) {
		if ( $error instanceof SiteForge_Runtime_Validation_Exception ) {
			throw $error;
		}
		if ( $error instanceof SiteForge_Runtime_Exception ) {
			throw new SiteForge_Runtime_Exception(
				$error->get_siteforge_code(),
				$error->getMessage(),
				$error->get_http_status(),
				array_merge( $error->get_details(), array( 'transactionId' => $transaction_id, 'phase' => $status['phase'], 'rollback' => $status['rollback'] ) ),
				$error
			);
		}
		throw new SiteForge_Runtime_Exception( 'siteforge_v3_deployment_failed', 'WordPress v3 transaction failed.', 500, array( 'transactionId' => $transaction_id, 'phase' => $status['phase'] ), $error );
	}

	private function acquire_lock() {
		$token = $this->uuid();
		$lock  = array( 'token' => $token, 'createdAt' => time() );
		if ( add_option( self::LOCK_OPTION, $lock, '', false ) ) {
			return $token;
		}
		$existing = get_option( self::LOCK_OPTION, array() );
		if ( ! is_array( $existing ) || empty( $existing['createdAt'] ) || (int) $existing['createdAt'] < time() - 300 ) {
			delete_option( self::LOCK_OPTION );
			if ( add_option( self::LOCK_OPTION, $lock, '', false ) ) {
				return $token;
			}
		}
		throw new SiteForge_Runtime_Exception( 'siteforge_v3_deployment_locked', 'Another SiteForge v3 transaction is in progress.', 423 );
	}

	private function release_lock( $token ) {
		$lock = get_option( self::LOCK_OPTION, array() );
		if ( is_array( $lock ) && isset( $lock['token'] ) && hash_equals( (string) $lock['token'], $token ) ) {
			delete_option( self::LOCK_OPTION );
		}
	}

	private function uuid() {
		return function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : sprintf(
			'%04x%04x-%04x-4%03x-%04x-%04x%04x%04x',
			mt_rand( 0, 0xffff ),
			mt_rand( 0, 0xffff ),
			mt_rand( 0, 0xffff ),
			mt_rand( 0, 0x0fff ),
			mt_rand( 0, 0x3fff ) | 0x8000,
			mt_rand( 0, 0xffff ),
			mt_rand( 0, 0xffff ),
			mt_rand( 0, 0xffff )
		);
	}
}
