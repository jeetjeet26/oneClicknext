<?php
/**
 * Authenticated SiteForge v2 REST surface.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_REST_Controller {
	const NAMESPACE = 'siteforge/v2';

	/** @var SiteForge_Runtime_Assets */
	private $assets;

	/** @var SiteForge_Runtime_Transactions */
	private $transactions;

	public function __construct( SiteForge_Runtime_Assets $assets, SiteForge_Runtime_Transactions $transactions ) {
		$this->assets       = $assets;
		$this->transactions = $transactions;
	}

	public function register_routes() {
		$authenticated = array( $this, 'authorize_permission' );

		register_rest_route(
			self::NAMESPACE,
			'/health',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'health' ),
				'permission_callback' => $authenticated,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/state',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'state' ),
				'permission_callback' => $authenticated,
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/capabilities',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'capabilities' ),
				'permission_callback' => $authenticated,
			)
		);
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
				'args'                => array(
					'transactionId' => array(
						'required'          => true,
						'type'              => 'string',
						'validate_callback' => static function ( $value ) {
							return is_string( $value ) && 1 === preg_match( SiteForge_Runtime_Validation::UUID_PATTERN, $value );
						},
					),
				),
			)
		);
	}

	public function authorize_permission( $request = null ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'siteforge_runtime_forbidden',
				'SiteForge runtime access requires an authenticated user with manage_options.',
				array( 'status' => is_user_logged_in() ? 403 : 401 )
			);
		}
		if (
			$request instanceof WP_REST_Request &&
			(string) ONECLICK_SITEFORGE_RUNTIME_CONTRACT_VERSION !== (string) $request->get_header( 'x-siteforge-contract-version' )
		) {
			return new WP_Error(
				'siteforge_runtime_unsupported_contract',
				'X-SiteForge-Contract-Version must be ' . ONECLICK_SITEFORGE_RUNTIME_CONTRACT_VERSION . '.',
				array( 'status' => 400 )
			);
		}
		return true;
	}

	public function authorize( $request = null ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			$status = is_user_logged_in() ? 403 : 401;
			return $this->error_response(
				403 === $status ? 'forbidden' : 'unauthorized',
				'SiteForge runtime access requires an authenticated user with manage_options.',
				false,
				'authentication',
				$status
			);
		}
		if ( $request instanceof WP_REST_Request ) {
			$version = (string) $request->get_header( 'x-siteforge-contract-version' );
			if ( (string) ONECLICK_SITEFORGE_RUNTIME_CONTRACT_VERSION !== $version ) {
				return $this->error_response(
					'unsupported_contract',
					'X-SiteForge-Contract-Version must be ' . ONECLICK_SITEFORGE_RUNTIME_CONTRACT_VERSION . '.',
					false,
					null,
					400
				);
			}
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
		$manifest    = get_option( SiteForge_Runtime_Transactions::MANIFEST_OPTION, array() );
		$verification= $this->transactions->verify_active_manifest();
		$verified    = isset( $verification['verified'] ) && true === $verification['verified'];
		$healthy     = $database_ok && ( empty( $manifest ) || $verified );

		return rest_ensure_response(
			array(
				'contractVersion' => 2,
				'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_VERSION,
				'status'          => $healthy ? 'ok' : 'degraded',
				'checkedAt'       => gmdate( 'c' ),
				'dependencies'    => array(
					array(
						'name'   => 'wordpress_database',
						'status' => $database_ok ? 'ok' : 'unavailable',
					),
					array(
						'name'    => 'active_manifest',
						'status'  => empty( $manifest ) || $verified ? 'ok' : 'degraded',
						'message' => empty( $manifest ) || $verified ? 'No drift detected.' : 'Stored manifest verification failed.',
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
		$site_id = trim( (string) $request->get_param( 'siteId' ) );
		if ( '' === $site_id || ! preg_match( SiteForge_Runtime_Validation::KEY_PATTERN, $site_id ) ) {
			return $this->error_response( 'invalid_artifact', 'siteId must be a runtime ID.', false, null, 400 );
		}
		return $this->respond(
			function () use ( $site_id ) {
				return $this->transactions->state( $site_id );
			},
			null
		);
	}

	public function capabilities( $request = null ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		$mime_types = get_allowed_mime_types();

		return rest_ensure_response(
			array(
				'contractVersion'          => 2,
				'runtimeVersion'           => ONECLICK_SITEFORGE_RUNTIME_VERSION,
				'provider'                 => 'wordpress',
				'authentication'           => 'wordpress_application_password',
				'features'                 => array(
					'immutableAssetPreparation' => true,
					'optimisticConcurrency'     => true,
					'idempotentDeployments'     => true,
					'transactionalRollback'     => true,
					'pageRemovals'              => true,
					'navigationMutation'        => true,
					'designTokenMutation'       => true,
					'siteSettingsMutation'      => true,
					'legalMutation'             => true,
					'analyticsMutation'         => true,
				),
				'limits'                    => array(
					'maxAssetsPerPreparation' => 100,
					'maxAssetBytes'            => wp_max_upload_size(),
					'maxPagesPerDeployment'     => 200,
					'acceptedAssetMimeTypes'   => array_values( array_unique( array_values( $mime_types ) ) ),
				),
			)
		);
	}

	public function prepare_assets( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				return $this->assets->prepare( $this->json_body( $request ) );
			},
			'asset_preparation'
		);
	}

	public function apply_deployment( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		return $this->respond(
			function () use ( $request ) {
				return $this->transactions->apply( $this->json_body( $request ) );
			},
			'preflight'
		);
	}

	public function deployment_status( WP_REST_Request $request ) {
		$denied = $this->authorize( $request );
		if ( true !== $denied ) {
			return $denied;
		}
		$transaction_id = strtolower( (string) $request->get_param( 'transactionId' ) );
		$status         = $this->transactions->get_status( $transaction_id );
		if ( null === $status ) {
			return $this->error_response(
				'deployment_not_found',
				'No SiteForge deployment exists for that transaction ID.',
				false,
				null,
				404
			);
		}
		return rest_ensure_response( $status );
	}

	private function json_body( WP_REST_Request $request ) {
		$content_type = (string) $request->get_header( 'content-type' );
		if ( false === stripos( $content_type, 'application/json' ) ) {
			throw new SiteForge_Runtime_Validation_Exception(
				'siteforge_invalid_content_type',
				'SiteForge v2 POST routes require application/json.',
				array( 'path' => 'headers.content-type' )
			);
		}
		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			throw new SiteForge_Runtime_Validation_Exception(
				'siteforge_invalid_json',
				'Request body must contain a JSON object.',
				array( 'path' => 'body' )
			);
		}
		return $body;
	}

	private function respond( $callback, $default_stage = 'preflight' ) {
		try {
			return rest_ensure_response( $callback() );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			return $this->error_response(
				'asset_preparation' === $default_stage ? 'invalid_asset' : 'invalid_plan',
				$error->getMessage(),
				false,
				$default_stage,
				400,
				$error->get_details()
			);
		} catch ( SiteForge_Runtime_Exception $error ) {
			$code    = $this->failure_code( $error->get_siteforge_code() );
			$details = $error->get_details();
			$stage   = false !== strpos( $error->get_siteforge_code(), 'asset' ) ? 'asset_preparation' : 'preflight';
			if ( isset( $details['phase'] ) && in_array( $details['phase'], array( 'preflight', 'pages', 'settings', 'navigation', 'removals', 'verification', 'manifest', 'rollback' ), true ) ) {
				$stage = $details['phase'];
			}
			return $this->error_response(
				$code,
				$error->getMessage(),
				in_array( $error->get_http_status(), array( 423, 429, 500, 502, 503, 504 ), true ),
				$stage,
				$error->get_http_status(),
				$details
			);
		} catch ( Throwable $error ) {
			return $this->error_response(
				'internal_error',
				'SiteForge runtime encountered an unexpected error.',
				true,
				$default_stage,
				500
			);
		}
	}

	private function failure_code( $runtime_code ) {
		if ( false !== strpos( $runtime_code, 'stale_remote' ) || false !== strpos( $runtime_code, 'remote_state_drift' ) ) {
			return 'stale_remote_state';
		}
		if ( false !== strpos( $runtime_code, 'idempotency' ) ) {
			return 'idempotency_conflict';
		}
		if ( false !== strpos( $runtime_code, 'site_identity' ) ) {
			return 'invalid_artifact';
		}
		if ( false !== strpos( $runtime_code, 'hash_mismatch' ) ) {
			return 'asset_hash_mismatch';
		}
		if ( false !== strpos( $runtime_code, 'asset' ) ) {
			return 'invalid_asset';
		}
		if ( false !== strpos( $runtime_code, 'capability' ) || false !== strpos( $runtime_code, 'unsupported' ) ) {
			return 'capability_mismatch';
		}
		if ( false !== strpos( $runtime_code, 'plan' ) || false !== strpos( $runtime_code, 'manifest' ) ) {
			return 'invalid_plan';
		}
		return 'operation_failed';
	}

	private function error_response( $code, $message, $retryable, $stage, $status, $details = array() ) {
		$error = array(
			'code'      => $code,
			'message'   => $message,
			'retryable' => (bool) $retryable,
		);
		if ( $stage ) {
			$error['stage'] = $stage;
		}
		if ( ! empty( $details ) ) {
			$error['details'] = $details;
		}
		return new WP_REST_Response(
			array(
				'contractVersion' => 2,
				'error'           => $error,
			),
			$status
		);
	}
}

