<?php
/**
 * Desired-state deployment transactions with compensating rollback.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_Transactions {
	const MANIFEST_OPTION    = 'oneclick_siteforge_runtime_manifest_v2';
	const TRANSACTIONS_OPTION = 'oneclick_siteforge_runtime_transactions_v2';
	const IDEMPOTENCY_OPTION = 'oneclick_siteforge_runtime_idempotency_v2';
	const LOCK_OPTION        = 'oneclick_siteforge_runtime_deployment_lock_v2';
	const PAGE_KEY_META      = '_siteforge_page_key';
	const PAGE_ARTIFACT_META = '_siteforge_artifact_id';
	const PAGE_HASH_META     = '_siteforge_page_content_hash';
	const PAGE_PURPOSE_META  = '_siteforge_page_purpose';
	const SEO_DECLARED_META  = '_siteforge_seo_declared';
	const SEO_TITLE_META     = '_siteforge_seo_title';
	const SEO_DESCRIPTION_META = '_siteforge_seo_description';
	const SEO_CANONICAL_META = '_siteforge_seo_canonical_path';
	const SEO_NOINDEX_META   = '_siteforge_seo_noindex';
	const SEO_JSON_LD_META   = '_siteforge_seo_json_ld';

	/** @var SiteForge_Runtime_Assets */
	private $assets;

	/** @var array */
	private $created_page_ids = array();

	public function __construct( SiteForge_Runtime_Assets $assets ) {
		$this->assets = $assets;
	}

	public function apply( $request ) {
		$input = SiteForge_Runtime_Validation::deployment_request( $request );
		$this->assert_preparation( $input );
		$this->created_page_ids = array();
		$prior = $this->lookup_idempotency( $input );
		if ( null !== $prior ) {
			$prior['idempotentReplay'] = true;
			return $this->public_status( $prior );
		}

		$lock_token = $this->acquire_lock();
		$snapshot   = null;
		$transaction_id = $this->uuid();
		$started_at = gmdate( 'c' );
		$prior_hash = $this->active_content_hash();
		$status     = array(
			'contractVersion'     => 2,
			'transactionId'      => $transaction_id,
			'status'             => 'running',
			'phase'              => 'preflight',
			'siteId'             => $input['siteId'],
			'artifactId'         => $input['artifactId'],
			'artifactContentHash'=> $input['artifactContentHash'],
			'assetManifestHash'  => $input['assetManifestHash'],
			'operationHash'      => $input['operationHash'],
			'idempotencyKey'     => $input['idempotencyKey'],
			'expectedRemoteContentHash' => $input['expectedRemoteContentHash'],
			'previousRemoteContentHash' => $prior_hash,
			'appliedContentHash' => null,
			'runtimeVersion'     => ONECLICK_SITEFORGE_RUNTIME_VERSION,
			'pageIds'            => array(),
			'mediaBindings'      => array(),
			'verification'       => null,
			'submittedAt'        => $started_at,
			'startedAt'          => $started_at,
			'completedAt'        => null,
			'idempotentReplay'   => false,
			'failure'            => null,
			'rollback'           => array(
				'attempted'            => false,
				'succeeded'            => null,
				'restoredContentHash'  => null,
				'failure'              => null,
			),
		);

		try {
			// Another request may have completed between the first idempotency
			// lookup and lock acquisition.
			$prior = $this->lookup_idempotency( $input );
			if ( null !== $prior ) {
				$prior['idempotentReplay'] = true;
				return $this->public_status( $prior );
			}

			$this->assert_site_identity( $input['siteId'] );
			$this->assert_expected_hash( $input['expectedRemoteContentHash'], $prior_hash );
			$this->assert_assets_available( $input['plan'] );
			$this->assert_plan_ownership( $input['plan'] );
			$this->store_transaction( $status );
			$this->store_idempotency( $input, $transaction_id );

			$snapshot = $this->snapshot( $input['plan'] );
			$status['phase'] = 'pages';
			$this->store_transaction( $status );
			$page_ids = $this->apply_pages( $input );

			$status['phase'] = 'settings';
			$this->store_transaction( $status );
			$this->apply_design_tokens( $input );
			$this->apply_runtime_configuration( $input );
			$this->apply_site_settings( $input, $page_ids );
			$this->apply_legal_and_analytics( $input );

			$status['phase'] = 'navigation';
			$this->store_transaction( $status );
			$navigation = $this->apply_navigation( $input['plan'], $page_ids );
			$status['phase'] = 'removals';
			$this->store_transaction( $status );
			$this->apply_removals( $input['plan'] );

			$status['phase'] = 'verification';
			$this->store_transaction( $status );
			$verification_spec = $this->verification_spec( $input, $page_ids, $navigation );
			$verification      = $this->verify( $verification_spec );
			if ( ! $verification['verified'] ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_verification_failed',
					'WordPress readback did not match the compiled desired state.',
					500,
					array( 'checks' => $verification['checks'] )
				);
			}

			$status['phase'] = 'manifest';
			$this->store_transaction( $status );
			$manifest = array(
				'contractVersion' => 2,
				'siteId'          => $input['siteId'],
				'artifactId'      => $input['artifactId'],
				'contentHash'     => $input['artifactContentHash'],
				'assetManifestHash'=> $input['assetManifestHash'],
				'operationHash'   => $input['operationHash'],
				'transactionId'   => $transaction_id,
				'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_VERSION,
				'pageIds'         => $page_ids,
				'mediaBindings'   => $this->referenced_bindings( $input ),
				'verificationSpec'=> $verification_spec,
				'verifiedAt'      => gmdate( 'c' ),
				'updatedAt'       => gmdate( 'c' ),
			);

			// This is deliberately the final desired-state write. A failed
			// transaction must never advertise the candidate artifact hash.
			$this->commit_manifest( $manifest );

			$status['status']      = 'succeeded';
			$status['phase']       = 'complete';
			$status['completedAt'] = gmdate( 'c' );
			$status['appliedContentHash'] = $input['artifactContentHash'];
			$status['runtimeVersion']     = ONECLICK_SITEFORGE_RUNTIME_VERSION;
			$status['pageIds']            = $page_ids;
			$status['mediaBindings']      = $manifest['mediaBindings'];
			$status['verification']       = $verification;
			$status['rollback']           = array(
				'attempted'           => false,
				'succeeded'           => null,
				'restoredContentHash' => $prior_hash,
				'failure'             => null,
			);
			$this->store_transaction( $status );
			return $this->public_status( $status );
		} catch ( Throwable $error ) {
			$status['status']      = 'failed';
			$status['completedAt'] = gmdate( 'c' );

			$status['rollback']['attempted'] = true;
			try {
				$rollback_error = null;
				if ( null !== $snapshot ) {
					try {
						$this->rollback( $snapshot );
					} catch ( Throwable $content_rollback_error ) {
						$rollback_error = $content_rollback_error;
					}
				}
				try {
					$this->assets->rollback_preparation( $input['assetPreparationId'], $input['artifactId'] );
				} catch ( Throwable $asset_rollback_error ) {
					if ( null === $rollback_error ) {
						$rollback_error = $asset_rollback_error;
					}
				}
				if ( null !== $rollback_error ) {
					throw $rollback_error;
				}
				if ( null !== $snapshot ) {
					$this->assert_rollback_readback( $snapshot );
				}
				$status['rollback']['succeeded']           = true;
				$status['rollback']['restoredContentHash'] = $prior_hash;
			} catch ( Throwable $rollback_error ) {
				$status['rollback']['succeeded'] = false;
				$status['rollback']['failure']   = $this->contract_failure( $rollback_error, 'rollback', $input );
			}
			$status['failure'] = $this->contract_failure( $error, $status['phase'], $input );
			$status['failure']['details']['rollback'] = $status['rollback'];
			$this->store_transaction( $status );

			if ( $error instanceof SiteForge_Runtime_Exception ) {
				throw new SiteForge_Runtime_Exception(
					$error->get_siteforge_code(),
					$error->getMessage(),
					$error->get_http_status(),
					array_merge(
						$error->get_details(),
						array(
							'transactionId' => $transaction_id,
							'phase'        => $status['phase'],
							'rollback'     => $status['rollback'],
						)
					),
					$error
				);
			}
			if ( $error instanceof SiteForge_Runtime_Validation_Exception ) {
				throw $error;
			}
			throw new SiteForge_Runtime_Exception(
				'siteforge_deployment_failed',
				'WordPress deployment failed during ' . $status['phase'] . '.',
				500,
				array(
					'transactionId' => $transaction_id,
					'phase'         => $status['phase'],
				),
				$error
			);
		} finally {
			$this->release_lock( $lock_token );
		}
	}

	public function get_status( $transaction_id ) {
		$transactions = get_option( self::TRANSACTIONS_OPTION, array() );
		if ( ! is_array( $transactions ) || ! isset( $transactions[ $transaction_id ] ) ) {
			return null;
		}
		return $this->public_status( $transactions[ $transaction_id ] );
	}

	public function state( $site_id = '' ) {
		$manifest = get_option( self::MANIFEST_OPTION, array() );
		if ( ! is_array( $manifest ) || empty( $manifest['contentHash'] ) ) {
			return array(
				'contractVersion' => 2,
				'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_VERSION,
				'siteId'          => $site_id,
				'artifactId'      => null,
				'artifactContentHash'=> null,
				'assetManifestHash'=> null,
				'operationHash'   => null,
				'transactionId'   => null,
				'pageIds'         => (object) array(),
				'mediaBindings'   => (object) array(),
				'updatedAt'       => null,
			);
		}
		$verification = $this->verify_active_manifest();
		if ( empty( $verification['verified'] ) ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_remote_state_drift',
				'WordPress no longer matches the active SiteForge manifest.',
				409,
				array( 'checks' => isset( $verification['checks'] ) ? $verification['checks'] : array() )
			);
		}
		if ( ! empty( $site_id ) && ! empty( $manifest['siteId'] ) && $site_id !== $manifest['siteId'] ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_site_identity_conflict',
				'This WordPress runtime is already bound to a different SiteForge site.',
				409,
				array(
					'requestedSiteId' => $site_id,
					'activeSiteId'    => $manifest['siteId'],
				)
			);
		}
		return array(
			'contractVersion' => 2,
			'runtimeVersion'  => ONECLICK_SITEFORGE_RUNTIME_VERSION,
			'siteId'          => isset( $manifest['siteId'] ) ? $manifest['siteId'] : $site_id,
			'artifactId'      => isset( $manifest['artifactId'] ) ? $manifest['artifactId'] : null,
			'artifactContentHash'=> $manifest['contentHash'],
			'assetManifestHash'=> isset( $manifest['assetManifestHash'] ) ? $manifest['assetManifestHash'] : null,
			'operationHash'   => isset( $manifest['operationHash'] ) ? $manifest['operationHash'] : null,
			'transactionId'   => isset( $manifest['transactionId'] ) ? $manifest['transactionId'] : null,
			'pageIds'         => ! empty( $manifest['pageIds'] ) ? $manifest['pageIds'] : (object) array(),
			'mediaBindings'   => ! empty( $manifest['mediaBindings'] ) ? $manifest['mediaBindings'] : (object) array(),
			'updatedAt'       => isset( $manifest['updatedAt'] ) ? $manifest['updatedAt'] : null,
		);
	}

	public function verify_active_manifest() {
		$manifest = get_option( self::MANIFEST_OPTION, array() );
		if ( ! is_array( $manifest ) || empty( $manifest['contentHash'] ) ) {
			return array(
				'verified' => true,
				'checks'   => array(),
			);
		}
		if ( ! isset( $manifest['verificationSpec'] ) || ! is_array( $manifest['verificationSpec'] ) ) {
			return array(
				'verified' => false,
				'checks'   => array(),
			);
		}
		return $this->verify( $manifest['verificationSpec'] );
	}

	private function normalize_submission( $submission ) {
		$input = $submission;
		foreach ( $input['plan']['pages'] as $index => $page ) {
			$input['plan']['pages'][ $index ]['content'] = $this->render_sections( $page['sections'] );
		}
		return $input;
	}

	private function render_sections( $sections ) {
		$blocks = array();
		foreach ( $sections as $section ) {
			$blocks[] = array(
				'sectionId' => $section['sectionId'],
				'name'      => $section['blockName'],
				'order'     => $section['order'],
				'variant'   => $section['variant'],
				'cssClasses'=> isset( $section['cssClasses'] ) ? $section['cssClasses'] : array(),
				'anchor'    => isset( $section['anchor'] ) ? $section['anchor'] : $section['sectionId'],
				'align'     => isset( $section['align'] ) ? $section['align'] : null,
				'data'      => $section['data'],
			);
		}
		usort(
			$blocks,
			static function ( $left, $right ) {
				return $left['order'] <=> $right['order'];
			}
		);
		return $this->render_blocks( $blocks );
	}

	private function render_blocks( $blocks ) {
		$output = array();
		foreach ( $blocks as $block ) {
			if ( 0 !== strpos( $block['name'], 'acf/' ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_block_unsupported',
					'Runtime pages may only contain registered ACF blocks.',
					422,
					array( 'block' => $block['name'] )
				);
			}
			if ( class_exists( 'WP_Block_Type_Registry' ) && ! WP_Block_Type_Registry::get_instance()->is_registered( $block['name'] ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_block_unsupported',
					'The active WordPress runtime does not register ' . $block['name'] . '.',
					422,
					array( 'block' => $block['name'] )
				);
			}
			$data = $this->bind_asset_references( $block['data'] );
			$attrs = array(
				'id'   => 'block_' . preg_replace( '/[^A-Za-z0-9_-]/', '_', $block['sectionId'] ),
				'name' => $block['name'],
				'data' => $data,
				'mode' => 'preview',
			);
			if ( ! empty( $block['anchor'] ) ) {
				$attrs['anchor'] = $block['anchor'];
			}
			if ( in_array( $block['align'], array( 'wide', 'full' ), true ) ) {
				$attrs['align'] = $block['align'];
			}
			if ( ! empty( $block['cssClasses'] ) ) {
				$attrs['className'] = implode( ' ', $block['cssClasses'] );
			}
			$json = wp_json_encode( $attrs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
			$json = str_replace( '--', '\\u002d\\u002d', $json );
			$output[] = '<!-- wp:' . $block['name'] . ' ' . $json . ' /-->';
		}
		return implode( "\n\n", $output );
	}

	private function bind_asset_references( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( isset( $value['assetId'] ) && is_string( $value['assetId'] ) ) {
			$binding = $this->assets->get_binding( $value['assetId'] );
			if ( null === $binding ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_not_prepared',
					'Page content references an asset that was not prepared.',
					422,
					array( 'assetId' => $value['assetId'] )
				);
			}
			return $binding['attachmentId'];
		}
		foreach ( $value as $key => $item ) {
			$value[ $key ] = $this->bind_asset_references( $item );
		}
		return $value;
	}

	private function managed_page_slugs() {
		$query = new WP_Query(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::PAGE_KEY_META,
			)
		);
		$slugs = array();
		foreach ( $query->posts as $post_id ) {
			$slug = get_post_field( 'post_name', $post_id );
			if ( is_string( $slug ) && '' !== $slug ) {
				$slugs[] = $slug;
			}
		}
		$legacy = get_option( 'oneclick_siteforge_content_manifest', array() );
		$legacy_ids = is_array( $legacy ) && isset( $legacy['page_ids'] ) && is_array( $legacy['page_ids'] )
			? array_map( 'absint', $legacy['page_ids'] )
			: array();
		foreach ( $legacy_ids as $post_id ) {
			$slug = get_post_field( 'post_name', $post_id );
			if ( is_string( $slug ) && '' !== $slug ) {
				$slugs[] = $slug;
			}
		}
		return array_values( array_unique( $slugs ) );
	}

	private function assert_preparation( $submission ) {
		$preparation = $this->assets->get_preparation( $submission['assetPreparationId'] );
		if (
			! is_array( $preparation ) ||
			$preparation['siteId'] !== $submission['siteId'] ||
			! hash_equals( $preparation['artifactId'], $submission['artifactId'] ) ||
			! hash_equals( $preparation['artifactContentHash'], $submission['artifactContentHash'] ) ||
			! hash_equals( $preparation['assetManifestHash'], $submission['assetManifestHash'] )
		) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_asset_preparation_invalid',
				'Deployment references a missing or mismatched immutable asset preparation.',
				422,
				array( 'assetPreparationId' => $submission['assetPreparationId'] )
			);
		}
	}

	private function public_status( $status ) {
		return array(
			'contractVersion'          => 2,
			'transactionId'            => $status['transactionId'],
			'status'                   => $status['status'],
			'phase'                    => $status['phase'],
			'siteId'                   => $status['siteId'],
			'artifactId'               => $status['artifactId'],
			'artifactContentHash'      => $status['artifactContentHash'],
			'assetManifestHash'        => $status['assetManifestHash'],
			'operationHash'            => $status['operationHash'],
			'idempotencyKey'           => $status['idempotencyKey'],
			'expectedRemoteContentHash'=> $status['expectedRemoteContentHash'],
			'previousRemoteContentHash'=> $status['previousRemoteContentHash'],
			'appliedContentHash'       => isset( $status['appliedContentHash'] ) ? $status['appliedContentHash'] : null,
			'runtimeVersion'           => $status['runtimeVersion'],
			'pageIds'                  => ! empty( $status['pageIds'] ) ? $status['pageIds'] : (object) array(),
			'mediaBindings'            => ! empty( $status['mediaBindings'] ) ? $status['mediaBindings'] : (object) array(),
			'rollback'                 => $status['rollback'],
			'verification'             => isset( $status['verification'] ) ? $status['verification'] : null,
			'submittedAt'              => $status['submittedAt'],
			'startedAt'                => isset( $status['startedAt'] ) ? $status['startedAt'] : null,
			'completedAt'              => isset( $status['completedAt'] ) ? $status['completedAt'] : null,
			'idempotentReplay'         => ! empty( $status['idempotentReplay'] ),
			'failure'                  => isset( $status['failure'] ) ? $status['failure'] : null,
		);
	}

	private function contract_failure( $error, $phase, $input ) {
		$code = 'operation_failed';
		if ( $error instanceof SiteForge_Runtime_Exception ) {
			$runtime_code = $error->get_siteforge_code();
			if ( false !== strpos( $runtime_code, 'stale_remote' ) ) {
				$code = 'stale_remote_state';
			} elseif ( false !== strpos( $runtime_code, 'idempotency' ) ) {
				$code = 'idempotency_conflict';
			} elseif ( false !== strpos( $runtime_code, 'site_identity' ) ) {
				$code = 'invalid_artifact';
			} elseif ( false !== strpos( $runtime_code, 'asset' ) ) {
				$code = false !== strpos( $runtime_code, 'hash' ) ? 'asset_hash_mismatch' : 'invalid_asset';
			} elseif ( false !== strpos( $runtime_code, 'capability' ) || false !== strpos( $runtime_code, 'block_unsupported' ) ) {
				$code = 'capability_mismatch';
			} elseif ( false !== strpos( $runtime_code, 'manifest' ) || false !== strpos( $runtime_code, 'plan' ) ) {
				$code = 'invalid_plan';
			}
			$details = $error->get_details();
		} else {
			$details = array();
		}
		$details['rollback'] = isset( $details['rollback'] ) ? $details['rollback'] : null;
		return array(
			'code'                      => $code,
			'message'                   => $error->getMessage(),
			'retryable'                 => in_array( $code, array( 'runtime_unavailable', 'rate_limited' ), true ),
			'stage'                     => in_array( $phase, array( 'preflight', 'pages', 'settings', 'navigation', 'removals', 'verification', 'manifest', 'rollback' ), true ) ? $phase : 'preflight',
			'operationHash'             => $input['operationHash'],
			'expectedRemoteContentHash' => $input['expectedRemoteContentHash'],
			'actualRemoteContentHash'   => $this->active_content_hash(),
			'details'                   => $details,
		);
	}

	private function lookup_idempotency( $input ) {
		$records = get_option( self::IDEMPOTENCY_OPTION, array() );
		$key     = hash( 'sha256', $input['idempotencyKey'] );
		if ( ! is_array( $records ) || ! isset( $records[ $key ] ) ) {
			return null;
		}
		$record = $records[ $key ];
		if (
			(string) ( $record['siteId'] ?? '' ) !== $input['siteId'] ||
			! hash_equals( (string) ( $record['operationHash'] ?? '' ), $input['operationHash'] ) ||
			! hash_equals( (string) ( $record['artifactContentHash'] ?? '' ), $input['artifactContentHash'] ) ||
			! hash_equals( (string) ( $record['assetManifestHash'] ?? '' ), $input['assetManifestHash'] ) ||
			(string) ( $record['artifactId'] ?? '' ) !== $input['artifactId'] ||
			(string) ( $record['assetPreparationId'] ?? '' ) !== $input['assetPreparationId'] ||
			(isset( $record['expectedRemoteContentHash'] ) ? (string) $record['expectedRemoteContentHash'] : null) !== $input['expectedRemoteContentHash']
		) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_idempotency_conflict',
				'idempotencyKey was already used for a different deployment.',
				409,
				array( 'transactionId' => isset( $record['transactionId'] ) ? $record['transactionId'] : null )
			);
		}
		$status = $this->get_status( $record['transactionId'] );
		if ( null === $status ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_idempotency_record_corrupt',
				'The idempotency record has no matching transaction.',
				500
			);
		}
		return $status;
	}

	private function store_idempotency( $input, $transaction_id ) {
		$records = get_option( self::IDEMPOTENCY_OPTION, array() );
		$records = is_array( $records ) ? $records : array();
		$key     = hash( 'sha256', $input['idempotencyKey'] );
		$records[ $key ] = array(
			'idempotencyKeyHash' => $key,
			'siteId'             => $input['siteId'],
			'artifactId'         => $input['artifactId'],
			'artifactContentHash'=> $input['artifactContentHash'],
			'assetManifestHash'  => $input['assetManifestHash'],
			'operationHash'      => $input['operationHash'],
			'assetPreparationId' => $input['assetPreparationId'],
			'expectedRemoteContentHash' => $input['expectedRemoteContentHash'],
			'transactionId'      => $transaction_id,
			'createdAt'          => gmdate( 'c' ),
		);
		$this->limit_records( $records, 500, 'createdAt' );
		update_option( self::IDEMPOTENCY_OPTION, $records, false );
	}

	private function store_transaction( $status ) {
		$transactions = get_option( self::TRANSACTIONS_OPTION, array() );
		$transactions = is_array( $transactions ) ? $transactions : array();
		$transactions[ $status['transactionId'] ] = $status;
		$this->limit_records( $transactions, 500, 'startedAt' );
		update_option( self::TRANSACTIONS_OPTION, $transactions, false );
	}

	private function limit_records( &$records, $limit, $date_key ) {
		if ( count( $records ) <= $limit ) {
			return;
		}
		uasort(
			$records,
			static function ( $left, $right ) use ( $date_key ) {
				return strcmp(
					isset( $left[ $date_key ] ) ? $left[ $date_key ] : '',
					isset( $right[ $date_key ] ) ? $right[ $date_key ] : ''
				);
			}
		);
		while ( count( $records ) > $limit ) {
			array_shift( $records );
		}
	}

	private function assert_expected_hash( $expected, $actual ) {
		if ( null === $expected && null === $actual ) {
			return;
		}
		if ( null === $expected || null === $actual || ! hash_equals( $expected, $actual ) ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_stale_remote_content_hash',
				'WordPress remote content changed after this deployment was compiled.',
				409,
				array(
					'expectedRemoteContentHash' => $expected,
					'actualRemoteContentHash'   => $actual,
				)
			);
		}
	}

	private function assert_site_identity( $site_id ) {
		$manifest = get_option( self::MANIFEST_OPTION, array() );
		if ( is_array( $manifest ) && ! empty( $manifest['siteId'] ) && $site_id !== $manifest['siteId'] ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_site_identity_conflict',
				'This WordPress runtime is already bound to a different SiteForge site.',
				409,
				array(
					'requestedSiteId' => $site_id,
					'activeSiteId'    => $manifest['siteId'],
				)
			);
		}
	}

	private function active_content_hash() {
		$manifest = get_option( self::MANIFEST_OPTION, array() );
		return is_array( $manifest ) && SiteForge_Runtime_Validation::is_hash( isset( $manifest['contentHash'] ) ? $manifest['contentHash'] : null )
			? $manifest['contentHash']
			: null;
	}

	private function assert_assets_available( $plan ) {
		$settings = isset( $plan['siteSettings'] ) ? $plan['siteSettings'] : array();
		foreach ( array( 'logoAssetId', 'faviconAssetId' ) as $key ) {
			if ( ! empty( $settings[ $key ] ) && null === $this->assets->get_binding( $settings[ $key ] ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_not_prepared',
					$key . ' references an immutable asset that has not been prepared.',
					422,
					array( 'assetId' => $settings[ $key ] )
				);
			}
		}
	}

	private function assert_plan_ownership( $plan ) {
		$desired_keys  = array();
		$desired_slugs = array();
		foreach ( $plan['pages'] as $page ) {
			$desired_keys[ $page['pageKey'] ]  = true;
			$desired_slugs[ $page['slug'] ]    = true;
		}
		foreach ( $plan['removals']['pageKeys'] as $key ) {
			if ( isset( $desired_keys[ $key ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_plan_conflict', 'A desired page cannot also be removed.', 422, array( 'pageKey' => $key ) );
			}
		}
		foreach ( $plan['removals']['pageSlugs'] as $slug ) {
			if ( isset( $desired_slugs[ $slug ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_plan_conflict', 'A desired page cannot also be removed.', 422, array( 'slug' => $slug ) );
			}
		}
	}

	private function snapshot( $plan ) {
		$page_ids = array();
		foreach ( $plan['pages'] as $page ) {
			$page_id = $this->find_page( $page['pageKey'], $page['slug'], true );
			if ( $page_id ) {
				$page_ids[] = $page_id;
			}
		}
		foreach ( $plan['removals']['pageKeys'] as $key ) {
			$page_id = $this->find_page( $key, '', false );
			if ( $page_id ) {
				$page_ids[] = $page_id;
			}
		}
		foreach ( $plan['removals']['pageSlugs'] as $slug ) {
			$page_id = $this->find_page( '', $slug, false );
			if ( $page_id ) {
				$page_ids[] = $page_id;
			}
		}
		$page_ids = array_values( array_unique( array_map( 'absint', $page_ids ) ) );
		$pages    = array();
		foreach ( $page_ids as $page_id ) {
			$post = get_post( $page_id, ARRAY_A );
			if ( $post ) {
				$pages[ $page_id ] = array(
					'post' => $post,
					'meta' => get_post_meta( $page_id ),
				);
			}
		}
		$all_managed = new WP_Query(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private', 'trash' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::PAGE_KEY_META,
			)
		);

		$options = array();
		foreach ( $this->mutable_options() as $option ) {
			$sentinel = '__siteforge_missing_' . wp_generate_uuid4();
			$value    = get_option( $option, $sentinel );
			$options[ $option ] = array(
				'exists' => $sentinel !== $value,
				'value'  => $sentinel !== $value ? $value : null,
			);
		}

		return array(
			'pages'         => $pages,
			'knownPageIds'  => $page_ids,
			'allManagedPageIds' => array_values( array_map( 'absint', $all_managed->posts ) ),
			'options'       => $options,
			'customLogo'    => get_theme_mod( 'custom_logo', null ),
			'navMenuLocations' => get_theme_mod( 'nav_menu_locations', array() ),
			'navigation'    => $this->snapshot_navigation( isset( $plan['navigation'] ) ? $plan['navigation'] : null ),
		);
	}

	private function apply_pages( $input ) {
		$page_ids = array();
		foreach ( $input['plan']['pages'] as $page ) {
			$page_id = $this->find_page( $page['pageKey'], $page['slug'], true );
			$was_new = ! $page_id;
			$content = $this->render_sections( $page['sections'] );
			$postarr  = array(
				'post_type'    => 'page',
				'post_title'   => wp_slash( $page['title'] ),
				'post_name'    => $page['slug'],
				'post_content' => wp_slash( $content ),
				'post_excerpt' => wp_slash( $page['excerpt'] ),
				'post_status'  => $page['status'],
				'menu_order'   => $page['menuOrder'],
			);
			if ( '' !== $page['template'] ) {
				$postarr['page_template'] = $page['template'];
			}
			if ( $page_id ) {
				$postarr['ID'] = $page_id;
			}
			$result = wp_insert_post( $postarr, true );
			if ( is_wp_error( $result ) || ! $result ) {
				$message = is_wp_error( $result ) ? $result->get_error_message() : 'unknown insert failure';
				throw new SiteForge_Runtime_Exception(
					'siteforge_page_apply_failed',
					'Could not apply page ' . $page['pageKey'] . ': ' . $message,
					500,
					array( 'pageKey' => $page['pageKey'] )
				);
			}
			$page_id = absint( $result );
			if ( $was_new ) {
				$this->created_page_ids[] = $page_id;
			}
			update_post_meta( $page_id, self::PAGE_KEY_META, $page['pageKey'] );
			update_post_meta( $page_id, self::PAGE_ARTIFACT_META, $input['artifactId'] );
			update_post_meta( $page_id, self::PAGE_PURPOSE_META, $page['purpose'] );
			update_post_meta( $page_id, self::PAGE_HASH_META, $this->page_hash( $page, $content ) );
			if ( isset( $page['seo'] ) && is_array( $page['seo'] ) ) {
				update_post_meta( $page_id, self::SEO_DECLARED_META, '1' );
				update_post_meta( $page_id, self::SEO_TITLE_META, $page['seo']['title'] );
				update_post_meta( $page_id, self::SEO_DESCRIPTION_META, $page['seo']['description'] );
				update_post_meta( $page_id, self::SEO_CANONICAL_META, $page['seo']['canonicalPath'] );
				update_post_meta( $page_id, self::SEO_NOINDEX_META, ! empty( $page['seo']['noIndex'] ) ? '1' : '0' );
				update_post_meta( $page_id, self::SEO_JSON_LD_META, $page['seo']['structuredData'] );
				delete_post_meta( $page_id, '_siteforge_canonical_path' );
				delete_post_meta( $page_id, '_siteforge_structured_data' );
				// Yoast is an adapter only; SiteForge metadata above remains canonical.
				update_post_meta( $page_id, '_yoast_wpseo_title', $page['seo']['title'] );
				update_post_meta( $page_id, '_yoast_wpseo_metadesc', $page['seo']['description'] );
				update_post_meta( $page_id, '_yoast_wpseo_meta-robots-noindex', ! empty( $page['seo']['noIndex'] ) ? '1' : '0' );
			} else {
				foreach ( array( self::SEO_DECLARED_META, self::SEO_TITLE_META, self::SEO_DESCRIPTION_META, self::SEO_CANONICAL_META, self::SEO_NOINDEX_META, self::SEO_JSON_LD_META, '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_meta-robots-noindex', '_siteforge_canonical_path', '_siteforge_structured_data' ) as $meta_key ) {
					delete_post_meta( $page_id, $meta_key );
				}
			}
			$page_ids[ $page['pageKey'] ] = $page_id;
		}
		ksort( $page_ids, SORT_STRING );
		return $page_ids;
	}

	private function apply_removals( $plan ) {
		$ids = array();
		foreach ( $plan['removals']['pageKeys'] as $key ) {
			$ids[] = $this->find_page( $key, '', false );
		}
		foreach ( $plan['removals']['pageSlugs'] as $slug ) {
			$ids[] = $this->find_page( '', $slug, false );
		}
		foreach ( array_unique( array_filter( array_map( 'absint', $ids ) ) ) as $page_id ) {
			if ( ! wp_trash_post( $page_id ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_page_removal_failed',
					'Could not remove a SiteForge-managed page.',
					500,
					array( 'pageId' => $page_id )
				);
			}
		}
	}

	private function apply_design_tokens( $input ) {
		if ( ! isset( $input['plan']['designTokens'] ) ) {
			return;
		}
		$tokens = $input['plan']['designTokens'];
		$tokens['content_hash'] = $input['artifactContentHash'];
		if ( false === update_option( 'oneclick_siteforge_design_tokens', $tokens, false ) && $tokens !== get_option( 'oneclick_siteforge_design_tokens' ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_design_tokens_failed', 'Could not persist SiteForge design tokens.', 500 );
		}
	}

	private function apply_runtime_configuration( $input ) {
		$plan = $input['plan'];
		if ( isset( $plan['siteConfiguration'] ) ) {
			$this->persist_option( 'oneclick_siteforge_configuration', $plan['siteConfiguration'], 'site configuration' );
			$this->persist_option( 'oneclick_siteforge_motion', $plan['siteConfiguration']['motion'], 'motion configuration' );
		}
		if ( isset( $plan['target'] ) ) {
			$this->persist_option( 'oneclick_siteforge_target', $plan['target'], 'target state' );
			$this->persist_option( 'oneclick_siteforge_target_mode', $plan['target']['mode'], 'target mode' );
		}
		if ( isset( $plan['publicRuntime'] ) ) {
			$this->persist_option( 'oneclick_siteforge_public_runtime', $plan['publicRuntime'], 'public runtime state' );
			$legacy_runtime = $plan['publicRuntime'];
			$legacy_runtime['certifiedContentHash'] = $input['artifactContentHash'];
			$this->persist_option( 'oneclick_siteforge_lumaleasing', $legacy_runtime, 'LumaLeasing public runtime state' );
		}
		if ( isset( $plan['protection'] ) ) {
			$this->persist_option( 'oneclick_siteforge_protection', $plan['protection'], 'protection state' );
			$this->persist_option(
				'blog_public',
				'public' === $plan['protection']['mode'] ? '1' : '0',
				'search-engine visibility'
			);
		}
	}

	private function persist_option( $option, $value, $label ) {
		if ( false === update_option( $option, $value, false ) && $value !== get_option( $option ) ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_runtime_configuration_failed',
				'Could not persist SiteForge ' . $label . '.',
				500,
				array( 'option' => $option )
			);
		}
	}

	private function apply_site_settings( $input, $page_ids ) {
		if ( ! isset( $input['plan']['siteSettings'] ) ) {
			return;
		}
		$settings = $input['plan']['siteSettings'];
		if ( isset( $settings['siteName'] ) ) {
			update_option( 'blogname', $settings['siteName'], false );
		}
		if ( isset( $settings['tagline'] ) ) {
			update_option( 'blogdescription', $settings['tagline'], false );
		}
		if ( isset( $settings['propertyProfile'] ) && is_array( $settings['propertyProfile'] ) ) {
			$profile      = $settings['propertyProfile'];
			$social_links = array();
			foreach ( isset( $profile['socialLinks'] ) && is_array( $profile['socialLinks'] ) ? $profile['socialLinks'] : array() as $platform => $url ) {
				$safe_url = esc_url_raw( (string) $url, array( 'http', 'https' ) );
				if ( $safe_url ) {
					$social_links[ sanitize_key( $platform ) ] = $safe_url;
				}
			}
			update_option(
				'oneclick_siteforge_property_profile',
				array(
					'name'        => sanitize_text_field( isset( $profile['name'] ) ? $profile['name'] : '' ),
					'address'     => sanitize_textarea_field( isset( $profile['address'] ) ? $profile['address'] : '' ),
					'phone'       => sanitize_text_field( isset( $profile['phone'] ) ? $profile['phone'] : '' ),
					'email'       => sanitize_email( isset( $profile['email'] ) ? $profile['email'] : '' ),
					'socialLinks' => $social_links,
				),
				false
			);
		}
		if ( ! empty( $settings['logoAssetId'] ) ) {
			$binding = $this->assets->get_binding( $settings['logoAssetId'] );
			set_theme_mod( 'custom_logo', $binding['attachmentId'] );
		}
		if ( array_key_exists( 'logoAssetId', $settings ) && empty( $settings['logoAssetId'] ) ) {
			remove_theme_mod( 'custom_logo' );
		}
		if ( ! empty( $settings['faviconAssetId'] ) ) {
			$binding = $this->assets->get_binding( $settings['faviconAssetId'] );
			update_option( 'site_icon', $binding['attachmentId'] );
		}
		if ( array_key_exists( 'faviconAssetId', $settings ) && empty( $settings['faviconAssetId'] ) ) {
			delete_option( 'site_icon' );
		}
		if ( ! empty( $settings['homepagePageKey'] ) ) {
			if ( ! isset( $page_ids[ $settings['homepagePageKey'] ] ) ) {
				$page_id = $this->find_page( $settings['homepagePageKey'], '', false );
			} else {
				$page_id = $page_ids[ $settings['homepagePageKey'] ];
			}
			if ( ! $page_id ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_homepage_missing',
					'homepagePageKey does not resolve to a managed page.',
					422,
					array( 'pageKey' => $settings['homepagePageKey'] )
				);
			}
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $page_id );
		}
	}

	private function apply_legal_and_analytics( $input ) {
		if ( isset( $input['plan']['legal'] ) ) {
			update_option( 'oneclick_siteforge_legal', $input['plan']['legal'], false );
		}
		if ( isset( $input['plan']['analytics'] ) ) {
			update_option( 'oneclick_siteforge_analytics', $input['plan']['analytics'], false );
		}
	}

	private function apply_navigation( $plan, $page_ids ) {
		if ( ! isset( $plan['navigation'] ) ) {
			return null;
		}
		$navigation = $plan['navigation'];
		$menu       = wp_get_nav_menu_object( $navigation['name'] );
		$menu_id    = $menu ? absint( $menu->term_id ) : wp_create_nav_menu( $navigation['name'] );
		if ( is_wp_error( $menu_id ) || ! $menu_id ) {
			$message = is_wp_error( $menu_id ) ? $menu_id->get_error_message() : 'unknown menu creation failure';
			throw new SiteForge_Runtime_Exception( 'siteforge_navigation_failed', 'Could not create navigation: ' . $message, 500 );
		}

		foreach ( wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) ) ?: array() as $existing_item ) {
			wp_delete_post( $existing_item->ID, true );
		}

		$item_ids = array();
		$pending  = $navigation['items'];
		$positions = array();
		foreach ( array_values( $navigation['items'] ) as $position => $item ) {
			$positions[ $item['itemKey'] ] = $position + 1;
		}
		while ( ! empty( $pending ) ) {
			$progress = false;
			foreach ( $pending as $index => $item ) {
				$parent_key = isset( $item['parentItemKey'] ) ? $item['parentItemKey'] : '';
				if ( '' !== $parent_key && ! isset( $item_ids[ $parent_key ] ) ) {
					continue;
				}
				$args = array(
					'menu-item-title'     => $item['label'],
					'menu-item-status'    => 'publish',
					'menu-item-position'  => $positions[ $item['itemKey'] ],
					'menu-item-parent-id' => '' === $parent_key ? 0 : $item_ids[ $parent_key ],
					'menu-item-target'    => isset( $item['target'] ) ? $item['target'] : '',
				);
				if ( ! empty( $item['pageKey'] ) ) {
					$page_id = isset( $page_ids[ $item['pageKey'] ] ) ? $page_ids[ $item['pageKey'] ] : $this->find_page( $item['pageKey'], '', false );
					if ( ! $page_id ) {
						throw new SiteForge_Runtime_Exception(
							'siteforge_navigation_page_missing',
							'Navigation references an unknown managed page.',
							422,
							array( 'pageKey' => $item['pageKey'] )
						);
					}
					$args['menu-item-object-id'] = $page_id;
					$args['menu-item-object']    = 'page';
					$args['menu-item-type']      = 'post_type';
				} else {
					$args['menu-item-url']  = $item['url'];
					$args['menu-item-type'] = 'custom';
				}
				$item_id = wp_update_nav_menu_item( $menu_id, 0, $args );
				if ( is_wp_error( $item_id ) || ! $item_id ) {
					$message = is_wp_error( $item_id ) ? $item_id->get_error_message() : 'unknown item failure';
					throw new SiteForge_Runtime_Exception( 'siteforge_navigation_failed', 'Could not create navigation item: ' . $message, 500 );
				}
				update_post_meta( $item_id, '_siteforge_nav_item_key', $item['itemKey'] );
				$item_ids[ $item['itemKey'] ] = absint( $item_id );
				unset( $pending[ $index ] );
				$progress = true;
			}
			if ( ! $progress ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_navigation_parent_cycle',
					'Navigation parentItemKey values contain a cycle or unknown parent.',
					422
				);
			}
		}

		$locations = get_theme_mod( 'nav_menu_locations', array() );
		$locations = is_array( $locations ) ? $locations : array();
		$locations[ $navigation['location'] ] = $menu_id;
		set_theme_mod( 'nav_menu_locations', $locations );

		return array(
			'menuId'   => absint( $menu_id ),
			'location' => $navigation['location'],
			'name'     => $navigation['name'],
			'itemIds'  => $item_ids,
		);
	}

	private function verification_spec( $input, $page_ids, $navigation ) {
		$settings = isset( $input['plan']['siteSettings'] ) ? $input['plan']['siteSettings'] : array();
		$pages    = array();
		foreach ( $input['plan']['pages'] as $page ) {
			$content = $this->render_sections( $page['sections'] );
			$pages[ $page['pageKey'] ] = array(
				'id'       => $page_ids[ $page['pageKey'] ],
				'slug'     => $page['slug'],
				'status'   => $page['status'],
				'pageHash' => $this->page_hash( $page, $content ),
				'expected' => array(
					'pageKey'   => $page['pageKey'],
					'slug'      => $page['slug'],
					'title'     => $page['title'],
					'purpose'   => $page['purpose'],
					'content'   => $content,
					'status'    => $page['status'],
					'menuOrder' => $page['menuOrder'],
					'template'  => $page['template'],
					'excerpt'   => $page['excerpt'],
					'seo'       => $page['seo'],
				),
			);
		}
		$spec = array(
			'pages'             => $pages,
			'removedPageKeys'   => $input['plan']['removals']['pageKeys'],
			'removedPageSlugs'  => isset( $input['plan']['removals']['pageSlugs'] ) ? $input['plan']['removals']['pageSlugs'] : array(),
			'designTokensHash'  => isset( $input['plan']['designTokens'] ) ? SiteForge_Runtime_Validation::hash( $input['plan']['designTokens'] ) : null,
			'siteName'          => $settings['siteName'],
			'tagline'           => $settings['tagline'],
			'logoAssetId'       => isset( $settings['logoAssetId'] ) ? $settings['logoAssetId'] : null,
			'logoDeclared'      => array_key_exists( 'logoAssetId', $settings ),
			'faviconAssetId'    => isset( $settings['faviconAssetId'] ) ? $settings['faviconAssetId'] : null,
			'faviconDeclared'   => array_key_exists( 'faviconAssetId', $settings ),
			'homepagePageKey'   => isset( $settings['homepagePageKey'] ) ? $settings['homepagePageKey'] : null,
			'legalHash'         => SiteForge_Runtime_Validation::hash( $input['plan']['legal'] ),
			'analyticsHash'     => SiteForge_Runtime_Validation::hash( $input['plan']['analytics'] ),
			'siteConfigurationHash' => isset( $input['plan']['siteConfiguration'] ) ? SiteForge_Runtime_Validation::hash( $input['plan']['siteConfiguration'] ) : null,
			'targetHash'        => isset( $input['plan']['target'] ) ? SiteForge_Runtime_Validation::hash( $input['plan']['target'] ) : null,
			'publicRuntimeHash' => isset( $input['plan']['publicRuntime'] ) ? SiteForge_Runtime_Validation::hash( $input['plan']['publicRuntime'] ) : null,
			'protectionHash'    => isset( $input['plan']['protection'] ) ? SiteForge_Runtime_Validation::hash( $input['plan']['protection'] ) : null,
			'blogPublic'        => isset( $input['plan']['protection'] ) ? ( 'public' === $input['plan']['protection']['mode'] ? '1' : '0' ) : null,
			'navigation'        => $navigation,
			'navigationItems'   => isset( $input['plan']['navigation']['items'] ) ? $input['plan']['navigation']['items'] : array(),
		);
		return $spec;
	}

	private function verify( $spec ) {
		$checks = array();
		foreach ( isset( $spec['pages'] ) ? $spec['pages'] : array() as $page_key => $expected ) {
			$post   = get_post( $expected['id'] );
			$actual_hash = $post
				? SiteForge_Runtime_Validation::hash(
					array(
						'pageKey'   => get_post_meta( $post->ID, self::PAGE_KEY_META, true ),
						'slug'      => $post->post_name,
						'title'     => $post->post_title,
						'purpose'   => get_post_meta( $post->ID, self::PAGE_PURPOSE_META, true ),
						'content'   => $post->post_content,
						'status'    => $post->post_status,
						'menuOrder' => (int) $post->menu_order,
						'template'  => (string) get_page_template_slug( $post->ID ),
						'excerpt'   => $post->post_excerpt,
						'seo'       => '1' !== get_post_meta( $post->ID, self::SEO_DECLARED_META, true )
							? null
							: array(
								'title'          => (string) get_post_meta( $post->ID, self::SEO_TITLE_META, true ),
								'description'    => (string) get_post_meta( $post->ID, self::SEO_DESCRIPTION_META, true ),
								'canonicalPath'  => (string) get_post_meta( $post->ID, self::SEO_CANONICAL_META, true ),
								'noIndex'        => '1' === (string) get_post_meta( $post->ID, self::SEO_NOINDEX_META, true ),
								'structuredData' => (array) get_post_meta( $post->ID, self::SEO_JSON_LD_META, true ),
							),
					)
				)
				: null;
			$passed = $post &&
				'page' === $post->post_type &&
				$expected['slug'] === $post->post_name &&
				$expected['status'] === $post->post_status &&
				$page_key === get_post_meta( $post->ID, self::PAGE_KEY_META, true ) &&
				hash_equals( $expected['pageHash'], (string) get_post_meta( $post->ID, self::PAGE_HASH_META, true ) ) &&
				hash_equals( $expected['pageHash'], (string) $actual_hash );
			$checks[] = $this->check( 'page:' . $page_key, $passed, $passed ? 'Page matches desired state.' : 'Page readback mismatch.' );
		}
		foreach ( isset( $spec['removedPageSlugs'] ) ? $spec['removedPageSlugs'] : array() as $slug ) {
			$query = new WP_Query(
				array(
					'post_type'      => 'page',
					'post_status'    => array( 'publish', 'draft', 'private' ),
					'name'           => $slug,
					'posts_per_page' => 1,
					'fields'         => 'ids',
					'no_found_rows'  => true,
				)
			);
			$passed = empty( $query->posts );
			$checks[] = $this->check( 'page_removed:' . $slug, $passed, $passed ? 'Removed page is inactive.' : 'Removed page remains active.' );
		}
		foreach ( isset( $spec['removedPageKeys'] ) ? $spec['removedPageKeys'] : array() as $page_key ) {
			$query = new WP_Query(
				array(
					'post_type'      => 'page',
					'post_status'    => array( 'publish', 'draft', 'private' ),
					'meta_key'       => self::PAGE_KEY_META,
					'meta_value'     => $page_key,
					'posts_per_page' => 1,
					'fields'         => 'ids',
					'no_found_rows'  => true,
				)
			);
			$passed = empty( $query->posts );
			$checks[] = $this->check( 'page_key_removed:' . $page_key, $passed, $passed ? 'Removed page key is inactive.' : 'Removed page key remains active.' );
		}

		$checks[] = $this->check( 'site_name', (string) get_option( 'blogname', '' ) === $spec['siteName'], 'Site name readback completed.' );
		$checks[] = $this->check( 'tagline', (string) get_option( 'blogdescription', '' ) === $spec['tagline'], 'Tagline readback completed.' );
		if ( ! empty( $spec['logoDeclared'] ) ) {
			$binding = ! empty( $spec['logoAssetId'] ) ? $this->assets->get_binding( $spec['logoAssetId'] ) : null;
			$passed  = empty( $spec['logoAssetId'] )
				? 0 === absint( get_theme_mod( 'custom_logo', 0 ) )
				: null !== $binding && absint( get_theme_mod( 'custom_logo', 0 ) ) === absint( $binding['attachmentId'] );
			$checks[] = $this->check( 'site_logo', $passed, $passed ? 'Logo attachment matches.' : 'Logo attachment mismatch.' );
		}
		if ( ! empty( $spec['faviconDeclared'] ) ) {
			$binding = ! empty( $spec['faviconAssetId'] ) ? $this->assets->get_binding( $spec['faviconAssetId'] ) : null;
			$passed  = empty( $spec['faviconAssetId'] )
				? 0 === absint( get_option( 'site_icon', 0 ) )
				: null !== $binding && absint( get_option( 'site_icon', 0 ) ) === absint( $binding['attachmentId'] );
			$checks[] = $this->check( 'favicon', $passed, $passed ? 'Favicon attachment matches.' : 'Favicon attachment mismatch.' );
		}
		if ( ! empty( $spec['homepagePageKey'] ) ) {
			$page    = isset( $spec['pages'][ $spec['homepagePageKey'] ] ) ? $spec['pages'][ $spec['homepagePageKey'] ] : null;
			$page_id = $page ? $page['id'] : $this->find_page( $spec['homepagePageKey'], '', false );
			$passed  = 'page' === get_option( 'show_on_front' ) && absint( get_option( 'page_on_front' ) ) === absint( $page_id );
			$checks[] = $this->check( 'homepage', $passed, $passed ? 'Homepage matches.' : 'Homepage mismatch.' );
		}
		if ( ! empty( $spec['designTokensHash'] ) ) {
			$tokens = get_option( 'oneclick_siteforge_design_tokens', array() );
			if ( is_array( $tokens ) ) {
				unset( $tokens['content_hash'] );
			}
			$actual = SiteForge_Runtime_Validation::hash( $tokens );
			$passed = hash_equals( $spec['designTokensHash'], $actual );
			$checks[] = $this->check( 'design_tokens', $passed, $passed ? 'Design tokens match.' : 'Design-token hash mismatch.' );
		}
		$checks[] = $this->check(
			'legal',
			hash_equals( $spec['legalHash'], SiteForge_Runtime_Validation::hash( get_option( 'oneclick_siteforge_legal', array() ) ) ),
			'Legal settings readback completed.'
		);
		$checks[] = $this->check(
			'analytics',
			hash_equals( $spec['analyticsHash'], SiteForge_Runtime_Validation::hash( get_option( 'oneclick_siteforge_analytics', array() ) ) ),
			'Analytics settings readback completed.'
		);
		foreach (
			array(
				'site_configuration' => array( 'hash' => 'siteConfigurationHash', 'option' => 'oneclick_siteforge_configuration' ),
				'target'             => array( 'hash' => 'targetHash', 'option' => 'oneclick_siteforge_target' ),
				'public_runtime'     => array( 'hash' => 'publicRuntimeHash', 'option' => 'oneclick_siteforge_public_runtime' ),
				'protection'         => array( 'hash' => 'protectionHash', 'option' => 'oneclick_siteforge_protection' ),
			) as $name => $state
		) {
			if ( ! empty( $spec[ $state['hash'] ] ) ) {
				$actual = SiteForge_Runtime_Validation::hash( get_option( $state['option'], array() ) );
				$passed = hash_equals( $spec[ $state['hash'] ], $actual );
				$checks[] = $this->check( $name, $passed, $passed ? 'Runtime state matches.' : 'Runtime-state hash mismatch.' );
			}
		}
		if ( array_key_exists( 'blogPublic', $spec ) && null !== $spec['blogPublic'] ) {
			$passed = (string) get_option( 'blog_public', '' ) === $spec['blogPublic'];
			$checks[] = $this->check( 'protection_visibility', $passed, $passed ? 'Protection visibility matches.' : 'Protection visibility mismatch.' );
		}
		if ( ! empty( $spec['navigation'] ) ) {
			$locations = get_theme_mod( 'nav_menu_locations', array() );
			$menu_id   = isset( $locations[ $spec['navigation']['location'] ] ) ? absint( $locations[ $spec['navigation']['location'] ] ) : 0;
			$items     = $menu_id ? ( wp_get_nav_menu_items( $menu_id ) ?: array() ) : array();
			$passed    = $menu_id === absint( $spec['navigation']['menuId'] ) && count( $items ) === count( $spec['navigationItems'] );
			if ( $passed ) {
				$items_by_id = array();
				$items_by_key = array();
				foreach ( $items as $menu_item ) {
					$items_by_id[ absint( $menu_item->ID ) ] = $menu_item;
					$item_key = get_post_meta( $menu_item->ID, '_siteforge_nav_item_key', true );
					if ( ! is_string( $item_key ) || '' === $item_key || isset( $items_by_key[ $item_key ] ) ) {
						$passed = false;
						break;
					}
					$items_by_key[ $item_key ] = $menu_item;
				}
				foreach ( $passed ? $spec['navigationItems'] : array() as $expected_position => $expected ) {
					if ( ! isset( $items_by_key[ $expected['itemKey'] ] ) ) {
						$passed = false;
						break;
					}
					$item = $items_by_key[ $expected['itemKey'] ];
					$actual_parent_key = null;
					if ( absint( $item->menu_item_parent ) > 0 && isset( $items_by_id[ absint( $item->menu_item_parent ) ] ) ) {
						$actual_parent_key = get_post_meta( absint( $item->menu_item_parent ), '_siteforge_nav_item_key', true );
					}
					$actual_page_key = 'post_type' === $item->type
						? get_post_meta( absint( $item->object_id ), self::PAGE_KEY_META, true )
						: null;
					$actual_url = 'custom' === $item->type ? $item->url : null;
					if (
						$expected['label'] !== $item->title ||
						$expected['target'] !== ( '' === $item->target ? '_self' : $item->target ) ||
						$expected_position + 1 !== absint( $item->menu_order ) ||
						$expected['parentItemKey'] !== $actual_parent_key ||
						$expected['pageKey'] !== $actual_page_key ||
						$expected['url'] !== $actual_url
					) {
						$passed = false;
						break;
					}
				}
			}
			$checks[] = $this->check( 'navigation', $passed, $passed ? 'Navigation matches.' : 'Navigation mismatch.' );
		}

		$verified = true;
		foreach ( $checks as $check ) {
			if ( ! $check['passed'] ) {
				$verified = false;
				break;
			}
		}
		return array(
			'verified'  => $verified,
			'checks'    => $checks,
			'verifiedAt'=> gmdate( 'c' ),
		);
	}

	private function check( $name, $passed, $message ) {
		return array(
			'name'    => $name,
			'passed'  => (bool) $passed,
			'message' => $message,
		);
	}

	private function page_hash( $page, $content = null ) {
		if ( null === $content ) {
			$content = $this->render_sections( $page['sections'] );
		}
		return SiteForge_Runtime_Validation::hash(
			array(
				'pageKey'   => $page['pageKey'],
				'slug'      => $page['slug'],
				'title'     => $page['title'],
				'purpose'   => $page['purpose'],
				'content'   => $content,
				'status'    => $page['status'],
				'menuOrder' => $page['menuOrder'],
				'template'  => $page['template'],
				'excerpt'   => $page['excerpt'],
				'seo'       => $page['seo'],
			)
		);
	}

	private function referenced_bindings( $input ) {
		$output      = array();
		$preparation = $this->assets->get_preparation( $input['assetPreparationId'] );
		foreach ( is_array( $preparation ) && isset( $preparation['assets'] ) ? $preparation['assets'] : array() as $prepared ) {
			$output[ $prepared['assetId'] ] = array(
				'attachmentId' => $prepared['attachmentId'],
				'url'          => $prepared['url'],
				'byteHash'     => $prepared['byteHash'],
				'mimeType'     => $prepared['mimeType'],
			);
		}
		ksort( $output, SORT_STRING );
		return $output;
	}

	private function commit_manifest( $manifest ) {
		$result = update_option( self::MANIFEST_OPTION, $manifest, false );
		if ( false === $result && $manifest !== get_option( self::MANIFEST_OPTION, array() ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_manifest_commit_failed', 'Could not commit the SiteForge manifest.', 500 );
		}
	}

	private function find_page( $page_key, $slug, $allow_adoption ) {
		if ( '' !== $page_key ) {
			$query = new WP_Query(
				array(
					'post_type'              => 'page',
					'post_status'            => array( 'publish', 'draft', 'private', 'trash' ),
					'posts_per_page'         => 2,
					'fields'                 => 'ids',
					'no_found_rows'          => true,
					'update_post_meta_cache' => false,
					'update_post_term_cache' => false,
					'meta_key'               => self::PAGE_KEY_META,
					'meta_value'             => $page_key,
				)
			);
			if ( count( $query->posts ) > 1 ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_page_identity_corrupt', 'Multiple pages claim the same pageKey.', 409, array( 'pageKey' => $page_key ) );
			}
			if ( ! empty( $query->posts ) ) {
				return absint( $query->posts[0] );
			}
		}
		if ( '' === $slug ) {
			return 0;
		}
		$page = get_page_by_path( $slug, OBJECT, 'page' );
		if ( ! $page ) {
			return 0;
		}
		$managed_key = get_post_meta( $page->ID, self::PAGE_KEY_META, true );
		if ( '' !== $managed_key ) {
			return absint( $page->ID );
		}
		if ( $this->legacy_manifest_owns_page( $page->ID ) ) {
			return absint( $page->ID );
		}
		throw new SiteForge_Runtime_Exception(
			'siteforge_page_slug_conflict',
			'The desired slug belongs to a page not managed by SiteForge.',
			409,
			array(
				'slug'   => $slug,
				'pageId' => absint( $page->ID ),
			)
		);
	}

	private function legacy_manifest_owns_page( $page_id ) {
		$legacy = get_option( 'oneclick_siteforge_content_manifest', array() );
		$ids    = is_array( $legacy ) && isset( $legacy['page_ids'] ) && is_array( $legacy['page_ids'] )
			? array_map( 'absint', $legacy['page_ids'] )
			: array();
		return in_array( absint( $page_id ), $ids, true );
	}

	private function mutable_options() {
		return array(
			'blogname',
			'blogdescription',
			'blog_public',
			'show_on_front',
			'page_on_front',
			'site_icon',
			'oneclick_siteforge_design_tokens',
			'oneclick_siteforge_configuration',
			'oneclick_siteforge_motion',
			'oneclick_siteforge_target',
			'oneclick_siteforge_target_mode',
			'oneclick_siteforge_public_runtime',
			'oneclick_siteforge_lumaleasing',
			'oneclick_siteforge_protection',
			'oneclick_siteforge_legal',
			'oneclick_siteforge_analytics',
		);
	}

	private function snapshot_navigation( $navigation ) {
		if ( ! is_array( $navigation ) || empty( $navigation['name'] ) ) {
			return null;
		}
		$menu = wp_get_nav_menu_object( $navigation['name'] );
		if ( ! $menu ) {
			return array(
				'existed' => false,
				'name'    => $navigation['name'],
				'menuId'  => null,
				'items'   => array(),
			);
		}
		$items = array();
		foreach ( wp_get_nav_menu_items( $menu->term_id, array( 'post_status' => 'any' ) ) ?: array() as $item ) {
			$items[] = array(
				'dbId'       => absint( $item->ID ),
				'title'      => $item->title,
				'url'        => $item->url,
				'objectId'   => absint( $item->object_id ),
				'object'     => $item->object,
				'type'       => $item->type,
				'status'     => $item->post_status,
				'position'   => absint( $item->menu_order ),
				'parentDbId' => absint( $item->menu_item_parent ),
				'target'     => $item->target,
				'classes'    => is_array( $item->classes ) ? $item->classes : array(),
			);
		}
		return array(
			'existed' => true,
			'name'    => $navigation['name'],
			'menuId'  => absint( $menu->term_id ),
			'items'   => $items,
		);
	}

	private function rollback( $snapshot ) {
		$current_managed = new WP_Query(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private', 'trash' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::PAGE_KEY_META,
			)
		);
		foreach ( $current_managed->posts as $page_id ) {
			if ( ! in_array( absint( $page_id ), $snapshot['allManagedPageIds'], true ) ) {
				wp_delete_post( $page_id, true );
			}
		}
		foreach ( $this->created_page_ids as $page_id ) {
			if ( get_post( $page_id ) ) {
				wp_delete_post( $page_id, true );
			}
		}
		foreach ( $snapshot['pages'] as $page_id => $saved ) {
			if ( 'trash' !== $saved['post']['post_status'] && 'trash' === get_post_status( $page_id ) ) {
				wp_untrash_post( $page_id );
			}
			$result = wp_update_post( wp_slash( $saved['post'] ), true );
			if ( is_wp_error( $result ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_rollback_page_failed', 'Could not restore page ' . $page_id . '.', 500 );
			}
			$this->restore_post_meta( $page_id, $saved['meta'] );
		}
		foreach ( $snapshot['options'] as $option => $saved ) {
			if ( $saved['exists'] ) {
				update_option( $option, $saved['value'] );
			} else {
				delete_option( $option );
			}
		}
		if ( null === $snapshot['customLogo'] ) {
			remove_theme_mod( 'custom_logo' );
		} else {
			set_theme_mod( 'custom_logo', $snapshot['customLogo'] );
		}
		set_theme_mod( 'nav_menu_locations', $snapshot['navMenuLocations'] );
		$this->restore_navigation( $snapshot['navigation'] );
	}

	private function assert_rollback_readback( $snapshot ) {
		$current_managed = new WP_Query(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private', 'trash' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::PAGE_KEY_META,
			)
		);
		$actual_ids   = array_values( array_map( 'absint', $current_managed->posts ) );
		$expected_ids = array_values( array_map( 'absint', $snapshot['allManagedPageIds'] ) );
		sort( $actual_ids, SORT_NUMERIC );
		sort( $expected_ids, SORT_NUMERIC );
		if ( $actual_ids !== $expected_ids ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_rollback_page_set_mismatch', 'Rollback page-set verification failed.', 500 );
		}
		foreach ( $this->created_page_ids as $page_id ) {
			if ( get_post( $page_id ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_rollback_created_page_remains', 'A release-created page remains after rollback.', 500, array( 'pageId' => $page_id ) );
			}
		}
		foreach ( $snapshot['pages'] as $page_id => $saved ) {
			$post = get_post( $page_id, ARRAY_A );
			$fields = array( 'post_title', 'post_name', 'post_content', 'post_excerpt', 'post_status', 'menu_order' );
			foreach ( $fields as $field ) {
				if ( ! is_array( $post ) || (string) $post[ $field ] !== (string) $saved['post'][ $field ] ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_rollback_page_mismatch', 'Rollback page verification failed.', 500, array( 'pageId' => absint( $page_id ), 'field' => $field ) );
				}
			}
			if ( SiteForge_Runtime_Validation::hash( get_post_meta( $page_id ) ) !== SiteForge_Runtime_Validation::hash( $saved['meta'] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_rollback_page_meta_mismatch', 'Rollback page metadata verification failed.', 500, array( 'pageId' => absint( $page_id ) ) );
			}
		}
		foreach ( $snapshot['options'] as $option => $saved ) {
			$sentinel = '__siteforge_rollback_missing_' . wp_generate_uuid4();
			$actual   = get_option( $option, $sentinel );
			if ( (bool) $saved['exists'] !== ( $sentinel !== $actual ) || ( $saved['exists'] && $actual !== $saved['value'] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_rollback_option_mismatch', 'Rollback option verification failed.', 500, array( 'option' => $option ) );
			}
		}
		if (
			get_theme_mod( 'custom_logo', null ) !== $snapshot['customLogo'] ||
			get_theme_mod( 'nav_menu_locations', array() ) !== $snapshot['navMenuLocations'] ||
			! $this->navigation_snapshot_matches( $snapshot['navigation'] )
		) {
			throw new SiteForge_Runtime_Exception( 'siteforge_rollback_theme_mismatch', 'Rollback theme and navigation verification failed.', 500 );
		}
	}

	private function navigation_snapshot_matches( $snapshot ) {
		if ( null === $snapshot ) {
			return true;
		}
		$menu = wp_get_nav_menu_object( $snapshot['name'] );
		if ( ! $snapshot['existed'] ) {
			return ! $menu;
		}
		if ( ! $menu ) {
			return false;
		}
		$actual = wp_get_nav_menu_items( $menu->term_id, array( 'post_status' => 'any' ) ) ?: array();
		if ( count( $actual ) !== count( $snapshot['items'] ) ) {
			return false;
		}
		$snapshot_parent_positions = array();
		foreach ( $snapshot['items'] as $item ) {
			$snapshot_parent_positions[ $item['dbId'] ] = $item['position'];
		}
		$actual_parent_positions = array();
		foreach ( $actual as $item ) {
			$actual_parent_positions[ absint( $item->ID ) ] = absint( $item->menu_order );
		}
		foreach ( array_values( $snapshot['items'] ) as $index => $expected ) {
			$item = $actual[ $index ];
			$expected_parent_position = isset( $snapshot_parent_positions[ $expected['parentDbId'] ] ) ? $snapshot_parent_positions[ $expected['parentDbId'] ] : 0;
			$actual_parent_position   = isset( $actual_parent_positions[ absint( $item->menu_item_parent ) ] ) ? $actual_parent_positions[ absint( $item->menu_item_parent ) ] : 0;
			if (
				(string) $expected['title'] !== (string) $item->title ||
				(string) $expected['url'] !== (string) $item->url ||
				(string) $expected['object'] !== (string) $item->object ||
				(string) $expected['type'] !== (string) $item->type ||
				(int) $expected['objectId'] !== absint( $item->object_id ) ||
				(int) $expected['position'] !== absint( $item->menu_order ) ||
				(string) $expected['target'] !== (string) $item->target ||
				(int) $expected_parent_position !== (int) $actual_parent_position
			) {
				return false;
			}
		}
		return true;
	}

	private function restore_post_meta( $post_id, $metadata ) {
		$current = get_post_meta( $post_id );
		foreach ( array_keys( $current ) as $meta_key ) {
			delete_post_meta( $post_id, $meta_key );
		}
		foreach ( $metadata as $meta_key => $values ) {
			foreach ( $values as $value ) {
				add_post_meta( $post_id, $meta_key, maybe_unserialize( $value ) );
			}
		}
	}

	private function restore_navigation( $snapshot ) {
		if ( null === $snapshot ) {
			return;
		}
		$menu = wp_get_nav_menu_object( $snapshot['name'] );
		if ( ! $snapshot['existed'] ) {
			if ( $menu ) {
				wp_delete_nav_menu( $menu->term_id );
			}
			return;
		}
		$menu_id = $menu ? absint( $menu->term_id ) : wp_create_nav_menu( $snapshot['name'] );
		if ( is_wp_error( $menu_id ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_rollback_navigation_failed', $menu_id->get_error_message(), 500 );
		}
		foreach ( wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) ) ?: array() as $item ) {
			wp_delete_post( $item->ID, true );
		}
		$new_ids = array();
		$pending = $snapshot['items'];
		while ( ! empty( $pending ) ) {
			$progress = false;
			foreach ( $pending as $index => $item ) {
				if ( $item['parentDbId'] && ! isset( $new_ids[ $item['parentDbId'] ] ) ) {
					continue;
				}
				$args = array(
					'menu-item-title'     => $item['title'],
					'menu-item-status'    => 'publish',
					'menu-item-position'  => $item['position'],
					'menu-item-parent-id' => $item['parentDbId'] ? $new_ids[ $item['parentDbId'] ] : 0,
					'menu-item-target'    => $item['target'],
					'menu-item-classes'   => implode( ' ', $item['classes'] ),
					'menu-item-object-id' => $item['objectId'],
					'menu-item-object'    => $item['object'],
					'menu-item-type'      => $item['type'],
					'menu-item-url'       => $item['url'],
				);
				$result = wp_update_nav_menu_item( $menu_id, 0, $args );
				if ( is_wp_error( $result ) ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_rollback_navigation_failed', $result->get_error_message(), 500 );
				}
				$new_ids[ $item['dbId'] ] = absint( $result );
				unset( $pending[ $index ] );
				$progress = true;
			}
			if ( ! $progress ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_rollback_navigation_failed', 'Saved navigation hierarchy is invalid.', 500 );
			}
		}
	}

	private function acquire_lock() {
		$token = $this->uuid();
		$lock  = array(
			'token'     => $token,
			'createdAt' => time(),
		);
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
		throw new SiteForge_Runtime_Exception(
			'siteforge_deployment_locked',
			'Another SiteForge deployment transaction is in progress.',
			423,
			array( 'retryAfterSeconds' => 5 )
		);
	}

	private function release_lock( $token ) {
		$lock = get_option( self::LOCK_OPTION, array() );
		if ( is_array( $lock ) && isset( $lock['token'] ) && hash_equals( (string) $lock['token'], $token ) ) {
			delete_option( self::LOCK_OPTION );
		}
	}

	private function failure( $error, $phase ) {
		if ( $error instanceof SiteForge_Runtime_Exception ) {
			$code    = $error->get_siteforge_code();
			$details = $error->get_details();
		} elseif ( $error instanceof SiteForge_Runtime_Validation_Exception ) {
			$code    = $error->get_siteforge_code();
			$details = $error->get_details();
		} else {
			$code    = 'siteforge_internal_error';
			$details = array();
		}
		return array(
			'phase'   => $phase,
			'code'    => $code,
			'message' => $error->getMessage(),
			'details' => $details,
		);
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

