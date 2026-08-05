<?php
/**
 * Authenticated SiteForge v3 REST surface.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_V3_REST_Controller {
	const NAMESPACE = 'siteforge/v3';

	/** @var SiteForge_Runtime_V3_State */
	private $state;

	/** @var SiteForge_Runtime_V3_Transactions */
	private $transactions;

	/** @var SiteForge_Runtime_V3_Assets */
	private $assets;

	public function __construct( SiteForge_Runtime_V3_State $state, SiteForge_Runtime_V3_Transactions $transactions, SiteForge_Runtime_V3_Assets $assets ) {
		$this->state        = $state;
		$this->transactions = $transactions;
		$this->assets       = $assets;
	}

	public function register_routes() {
		$authenticated = array( $this, 'authorize_permission' );
		foreach (
			array(
				'/health'       => 'health',
				'/state'        => 'state',
				'/capabilities' => 'capabilities',
				'/projection/v2'=> 'v2_projection',
			) as $route => $callback
		) {
			register_rest_route(
				self::NAMESPACE,
				$route,
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, $callback ),
					'permission_callback' => $authenticated,
				)
			);
		}
		register_rest_route(
			self::NAMESPACE,
			'/assets/prepare',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'prepare_assets' ),
				'permission_callback' => $authenticated,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/deployments',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'apply_deployment' ),
				'permission_callback' => $authenticated,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/deployments/(?P<transactionId>[0-9a-fA-F-]{36})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'deployment_status' ),
				'permission_callback' => $authenticated,
				'args'                => $this->transaction_args(),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/deployments/(?P<transactionId>[0-9a-fA-F-]{36})/rollback',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rollback_deployment' ),
				'permission_callback' => $authenticated,
				'args'                => $this->transaction_args(),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/rollbacks',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rollback_request' ),
				'permission_callback' => $authenticated,
			)
		);
	}

	public function authorize_permission( $request = null ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'siteforge_runtime_v3_forbidden',
				'SiteForge v3 runtime access requires an authenticated user with manage_options.',
				array( 'status' => is_user_logged_in() ? 403 : 401 )
			);
		}
		if ( $request instanceof WP_REST_Request && '3' !== (string) $request->get_header( 'x-siteforge-contract-version' ) ) {
			return new WP_Error(
				'siteforge_runtime_v3_unsupported_contract',
				'X-SiteForge-Contract-Version must be 3.',
				array( 'status' => 400 )
			);
		}
		return true;
	}

	public function health( $request = null ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		global $wpdb;
		$database_ok = isset( $wpdb ) && (string) $wpdb->get_var( 'SELECT 1' ) === '1';
		try {
			$verification = $this->state->verify();
		} catch ( Throwable $error ) {
			$verification = array(
				'verified' => false,
				'checks'   => array(),
			);
		}
		$projection_ok = true;
		try {
			$this->state->projection();
		} catch ( Throwable $error ) {
			$projection_ok = false;
		}
		$healthy = $database_ok && ! empty( $verification['verified'] ) && $projection_ok;
		$installed_runtime = $this->installed_runtime_identity();
		return rest_ensure_response(
			array(
				'contractVersion' => 3,
				'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
				'namespace'       => self::NAMESPACE,
				'status'          => $healthy ? 'ok' : 'degraded',
				'checkedAt'       => gmdate( 'c' ),
				'installedRuntime'=> $installed_runtime,
				'dependencies'    => array(
					array(
						'name'   => 'wordpress_database',
						'status' => $database_ok ? 'ok' : 'unavailable',
					),
					array(
						'name'    => 'v3_resource_graph',
						'status'  => ! empty( $verification['verified'] ) ? 'ok' : 'degraded',
						'message' => ! empty( $verification['verified'] ) ? 'No v3 resource drift detected.' : 'Stored v3 resource verification failed.',
					),
					array(
						'name'    => 'v2_downgrade_projection',
						'status'  => $projection_ok ? 'ok' : 'degraded',
						'message' => $projection_ok ? 'Projection is absent or strict v2-compatible.' : 'Projection validation failed.',
					),
				),
			)
		);
	}

	public function state( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				$site_id = trim( (string) $request->get_param( 'siteId' ) );
				if ( '' === $site_id || ! preg_match( SiteForge_Runtime_Validation::KEY_PATTERN, $site_id ) ) {
					throw new SiteForge_Runtime_Validation_Exception( 'siteforge_v3_invalid_request', 'siteId must be a runtime ID.', array( 'path' => 'siteId' ) );
				}
				return $this->state->read( $site_id );
			},
			'state'
		);
	}

	public function capabilities( $request = null ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return rest_ensure_response(
			array(
				'contractVersion' => 3,
				'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
				'provider'        => 'wordpress',
				'authentication'  => 'wordpress_application_password',
				'features'        => array(
					'completeResourceGraph'     => true,
					'exactPackageIdentity'      => true,
					'immutableAssetPreparation' => true,
					'optimisticConcurrency'     => true,
					'idempotentTransactions'    => true,
					'transactionalRollback'     => true,
					'v2RollbackProjection'      => true,
					'scopedIntegrations'        => true,
					'targetProtection'          => true,
					'publicRuntime'              => true,
				),
				'limits'          => array(
					'maxAssetsPerPreparation'    => 2000,
					'maxAssetBytes'               => wp_max_upload_size(),
					'maxResourcesPerDeployment'  => 20000,
					'maxOperationsPerDeployment' => 20000,
					'acceptedAssetMimeTypes'     => array_values( array_unique( array_values( get_allowed_mime_types() ) ) ),
				),
			)
		);
	}

	public function v2_projection( $request = null ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () {
				$projection = $this->state->projection();
				return array(
					'contractVersion' => 3,
					'projection'      => $projection,
				);
			},
			'state'
		);
	}

	public function apply_deployment( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				$body = $this->json_body( $request );
				SiteForge_Runtime_V3_Validation::deployment_request( $body );
				$this->assert_deployment_headers( $request, $body );
				return $this->transactions->apply( $body );
			},
			'preflight'
		);
	}

	public function prepare_assets( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				$body = $this->json_body( $request );
				SiteForge_Runtime_V3_Validation::asset_request( $body );
				$this->assert_asset_headers( $request, $body );
				return $this->assets->prepare( $body );
			},
			'asset_preparation'
		);
	}

	public function deployment_status( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		$status = $this->transactions->get_status( strtolower( (string) $request->get_param( 'transactionId' ) ) );
		if ( null === $status ) {
			return $this->error_response( 'deployment_not_found', 'No SiteForge v3 deployment exists for that transaction ID.', false, 'state', 404 );
		}
		return rest_ensure_response( $status );
	}

	public function rollback_deployment( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				$input = SiteForge_Runtime_V3_Validation::rollback_request( $this->json_body( $request ) );
				if ( strtolower( $input['transactionId'] ) !== strtolower( (string) $request->get_param( 'transactionId' ) ) ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_identity_conflict', 'Rollback path and body transaction identities differ.', 409 );
				}
				$this->assert_rollback_headers( $request, $input );
				return $this->transactions->rollback( $input );
			},
			'rollback'
		);
	}

	public function rollback_request( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				$input = SiteForge_Runtime_V3_Validation::rollback_request( $this->json_body( $request ) );
				$this->assert_rollback_headers( $request, $input );
				$state = $this->state->read( $input['siteId'] );
				if ( null !== $state['transactionId'] && $state['transactionId'] !== $input['transactionId'] ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_rollback_identity_conflict', 'Rollback transaction does not own the active v3 state.', 409 );
				}
				return $this->transactions->rollback( $input );
			},
			'rollback'
		);
	}

	private function authorize( $request = null ) {
		$result = $this->authorize_permission( $request );
		if ( true === $result ) {
			return true;
		}
		$status = is_user_logged_in() ? 403 : 401;
		if ( $request instanceof WP_REST_Request && current_user_can( 'manage_options' ) ) {
			$status = 400;
		}
		return $this->error_response(
			400 === $status ? 'unsupported_contract' : ( 403 === $status ? 'forbidden' : 'unauthorized' ),
			400 === $status ? 'X-SiteForge-Contract-Version must be 3.' : 'SiteForge v3 runtime access requires manage_options.',
			false,
			'authentication',
			$status
		);
	}

	private function json_body( WP_REST_Request $request ) {
		if ( false === stripos( (string) $request->get_header( 'content-type' ), 'application/json' ) ) {
			throw new SiteForge_Runtime_Validation_Exception( 'siteforge_v3_invalid_content_type', 'SiteForge v3 POST routes require application/json.', array( 'path' => 'headers.content-type' ) );
		}
		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			throw new SiteForge_Runtime_Validation_Exception( 'siteforge_v3_invalid_json', 'Request body must contain a JSON object.', array( 'path' => 'body' ) );
		}
		return $body;
	}

	private function assert_asset_headers( WP_REST_Request $request, $body ) {
		$this->assert_header( $request, 'idempotency-key', $body['idempotencyKey'] );
		$this->assert_header( $request, 'x-siteforge-artifact-id', $body['identity']['artifactId'] );
		$this->assert_header( $request, 'x-siteforge-artifact-content-hash', $body['identity']['artifactContentHash'] );
		$this->assert_header( $request, 'x-siteforge-asset-manifest-hash', $body['identity']['assetManifestHash'] );
	}

	private function assert_deployment_headers( WP_REST_Request $request, $body ) {
		$identity = $body['release']['identity'];
		$this->assert_header( $request, 'idempotency-key', $body['idempotencyKey'] );
		$this->assert_header( $request, 'x-siteforge-artifact-id', $identity['artifactId'] );
		$this->assert_header( $request, 'x-siteforge-artifact-content-hash', $identity['artifactContentHash'] );
		$this->assert_header( $request, 'x-siteforge-asset-manifest-hash', $identity['assetManifestHash'] );
		$this->assert_header( $request, 'x-siteforge-resource-graph-hash', $identity['resourceGraphHash'] );
		$this->assert_header( $request, 'x-siteforge-operation-set-hash', $identity['operationSetHash'] );
		$this->assert_header( $request, 'x-siteforge-runtime-archive-sha256', $identity['runtimePackage']['archiveSha256'] );
		$this->assert_header( $request, 'x-siteforge-runtime-manifest-sha256', $identity['runtimePackage']['manifestSha256'] );
		if ( null === $body['expectedRemoteContentHash'] ) {
			$this->assert_header( $request, 'if-none-match', '*' );
		} else {
			$this->assert_header( $request, 'if-match', '"' . $body['expectedRemoteContentHash'] . '"' );
		}
	}

	private function assert_rollback_headers( WP_REST_Request $request, $body ) {
		$this->assert_header( $request, 'idempotency-key', $body['idempotencyKey'] );
		$this->assert_header( $request, 'x-siteforge-artifact-content-hash', $body['restoreArtifactContentHash'] );
		$this->assert_header( $request, 'x-siteforge-resource-graph-hash', $body['restoreResourceGraphHash'] );
		$this->assert_header( $request, 'if-match', '"' . $body['expectedCurrentContentHash'] . '"' );
	}

	private function assert_header( WP_REST_Request $request, $name, $expected ) {
		if ( (string) $expected !== (string) $request->get_header( $name ) ) {
			throw new SiteForge_Runtime_Validation_Exception(
				'siteforge_v3_identity_header_mismatch',
				'V3 identity header does not match the strict request body.',
				array( 'path' => 'headers.' . $name )
			);
		}
	}

	private function respond( $callback, $stage ) {
		try {
			return rest_ensure_response( $callback() );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			return $this->error_response( 'invalid_artifact', $error->getMessage(), false, $stage, 400, $error->get_details() );
		} catch ( SiteForge_Runtime_Exception $error ) {
			$details = $error->get_details();
			if ( isset( $details['phase'] ) ) {
				$stage = $details['phase'];
			}
			return $this->error_response(
				$this->failure_code( $error->get_siteforge_code() ),
				$error->getMessage(),
				in_array( $error->get_http_status(), array( 423, 429, 500, 502, 503, 504 ), true ),
				$stage,
				$error->get_http_status(),
				$details
			);
		} catch ( Throwable $error ) {
			return $this->error_response( 'internal_error', 'SiteForge v3 runtime encountered an unexpected error.', true, $stage, 500 );
		}
	}

	private function failure_code( $code ) {
		foreach (
			array(
				'stale_remote' => 'stale_remote_state',
				'idempotency'  => 'idempotency_conflict',
				'not_found'    => 'deployment_not_found',
				'identity'     => 'invalid_artifact',
				'invalid'      => 'invalid_artifact',
				'locked'       => 'runtime_unavailable',
			) as $needle => $failure
		) {
			if ( false !== strpos( $code, $needle ) ) {
				return $failure;
			}
		}
		return 'operation_failed';
	}

	private function error_response( $code, $message, $retryable, $stage, $status, $details = array() ) {
		$error = array(
			'code'      => $code,
			'message'   => $message,
			'retryable' => (bool) $retryable,
			'stage'     => $stage,
		);
		if ( ! empty( $details ) ) {
			$error['details'] = $details;
		}
		return new WP_REST_Response(
			array(
				'contractVersion' => 3,
				'error'           => $error,
			),
			$status
		);
	}

	private function transaction_args() {
		return array(
			'transactionId' => array(
				'required'          => true,
				'type'              => 'string',
				'validate_callback' => static function ( $value ) {
					return is_string( $value ) && 1 === preg_match( SiteForge_Runtime_Validation::UUID_PATTERN, $value );
				},
			),
		);
	}

	private function installed_runtime_identity() {
		$active = get_option( SiteForge_Runtime_V3_State::ACTIVE_OPTION, array() );
		if ( is_array( $active ) && isset( $active['identity']['runtimePackage'] ) ) {
			return $active['identity']['runtimePackage'];
		}
		$manifest = array(
			'schemaVersion'   => 1,
			'contractVersion' => 3,
			'packageName'     => 'oneclick-siteforge-runtime',
			'packageVersion'  => ONECLICK_SITEFORGE_RUNTIME_V3_VERSION,
			'files'           => array(
				array(
					'path'       => 'oneclick-siteforge-runtime.php',
					'byteSha256' => hash_file( 'sha256', ONECLICK_SITEFORGE_RUNTIME_FILE ),
					'bytes'      => filesize( ONECLICK_SITEFORGE_RUNTIME_FILE ),
					'mode'       => 'file',
				),
			),
		);
		return array(
			'packageId'      => 'runtime:oneclick-siteforge-runtime',
			'packageType'    => 'runtime_plugin',
			'archiveSha256'  => hash( 'sha256', 'installed:' . hash_file( 'sha256', ONECLICK_SITEFORGE_RUNTIME_FILE ) ),
			'archiveBytes'   => max( 1, (int) filesize( ONECLICK_SITEFORGE_RUNTIME_FILE ) ),
			'manifestSha256' => SiteForge_Runtime_Validation::hash( $manifest ),
			'manifest'       => $manifest,
		);
	}
}
