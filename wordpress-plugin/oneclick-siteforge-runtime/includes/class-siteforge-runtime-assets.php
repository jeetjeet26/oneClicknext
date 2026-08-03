<?php
/**
 * Immutable SiteForge asset preparation and attachment bindings.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_Assets {
	const REGISTRY_OPTION = 'oneclick_siteforge_runtime_asset_bindings_v2';
	const PREPARATIONS_OPTION = 'oneclick_siteforge_runtime_asset_preparations_v2';
	const META_ASSET_ID   = '_siteforge_asset_id';
	const META_BYTE_HASH  = '_siteforge_byte_hash';
	const META_SOURCE_URL = '_siteforge_source_url';
	const META_ARTIFACTS  = '_siteforge_artifact_ids';

	/**
	 * Prepare exact assets. Existing asset IDs may only be reused with their
	 * original byte hash; retries return the same attachment binding.
	 */
	public function prepare( $request ) {
		$input    = SiteForge_Runtime_Validation::asset_request( $request );
		$preparation_id = 'prep:' . substr( $input['idempotencyKey'], 0, 40 );
		$existing_preparation = $this->get_preparation( $preparation_id );
		if ( is_array( $existing_preparation ) ) {
			foreach ( array( 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'idempotencyKey' ) as $field ) {
				if ( ! isset( $existing_preparation[ $field ] ) || (string) $existing_preparation[ $field ] !== (string) $input[ $field ] ) {
					throw new SiteForge_Runtime_Exception(
						'siteforge_asset_idempotency_conflict',
						'Asset preparation idempotencyKey was already used for a different payload.',
						409,
						array( 'preparationId' => $preparation_id )
					);
				}
			}
			return $existing_preparation;
		}
		$bindings = array();

		foreach ( $input['assets'] as $asset ) {
			$bindings[] = $this->prepare_one( $input['artifactId'], $asset );
		}

		$result = array(
			'contractVersion' => 2,
			'preparationId'   => $preparation_id,
			'siteId'          => $input['siteId'],
			'artifactId'      => $input['artifactId'],
			'artifactContentHash'=> $input['artifactContentHash'],
			'assetManifestHash'=> $input['assetManifestHash'],
			'idempotencyKey'  => $input['idempotencyKey'],
			'assets'          => array_map(
				static function ( $binding ) {
					return array(
						'assetId'      => $binding['assetId'],
						'byteHash'     => $binding['byteHash'],
						'attachmentId' => $binding['attachmentId'],
						'url'          => $binding['url'],
						'mimeType'     => $binding['mimeType'],
						'disposition'  => $binding['reused'] ? 'reused' : 'created',
					);
				},
				$bindings
			),
			'preparedAt'      => gmdate( 'c' ),
		);
		$preparations = get_option( self::PREPARATIONS_OPTION, array() );
		$preparations = is_array( $preparations ) ? $preparations : array();
		$preparations[ $result['preparationId'] ] = $result;
		update_option( self::PREPARATIONS_OPTION, $preparations, false );
		return $result;
	}

	public function get_preparation( $preparation_id ) {
		$preparations = get_option( self::PREPARATIONS_OPTION, array() );
		return is_array( $preparations ) && isset( $preparations[ $preparation_id ] )
			? $preparations[ $preparation_id ]
			: null;
	}

	public function get_binding( $asset_id ) {
		$registry = $this->registry();
		if ( ! isset( $registry[ $asset_id ] ) || ! is_array( $registry[ $asset_id ] ) ) {
			return null;
		}
		$binding = $registry[ $asset_id ];
		$post_id = isset( $binding['attachmentId'] ) ? absint( $binding['attachmentId'] ) : 0;
		if ( ! $post_id || 'attachment' !== get_post_type( $post_id ) ) {
			return null;
		}
		$metadata_hash = (string) get_post_meta( $post_id, self::META_BYTE_HASH, true );
		if (
			$asset_id !== get_post_meta( $post_id, self::META_ASSET_ID, true ) ||
			! SiteForge_Runtime_Validation::is_hash( $metadata_hash ) ||
			! isset( $binding['byteHash'] ) ||
			! hash_equals( $metadata_hash, (string) $binding['byteHash'] )
		) {
			return null;
		}
		$file = function_exists( 'get_attached_file' ) ? get_attached_file( $post_id ) : false;
		if ( ! is_string( $file ) || ! is_file( $file ) ) {
			return null;
		}
		$actual_hash = hash_file( 'sha256', $file );
		if ( false === $actual_hash || ! hash_equals( $metadata_hash, $actual_hash ) ) {
			return null;
		}
		return $binding;
	}

	public function all_bindings() {
		$output = array();
		foreach ( $this->registry() as $asset_id => $binding ) {
			$verified = $this->get_binding( $asset_id );
			if ( null !== $verified ) {
				$output[ $asset_id ] = $verified;
			}
		}
		ksort( $output, SORT_STRING );
		return $output;
	}

	private function prepare_one( $artifact_id, $asset ) {
		$lock_name = 'oneclick_siteforge_asset_lock_' . substr( hash( 'sha256', $asset['assetId'] ), 0, 32 );
		$lock      = array(
			'token'     => function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'siteforge_', true ),
			'createdAt' => time(),
		);
		if ( ! add_option( $lock_name, $lock, '', false ) ) {
			$existing_lock = get_option( $lock_name, array() );
			if ( is_array( $existing_lock ) && isset( $existing_lock['createdAt'] ) && (int) $existing_lock['createdAt'] < time() - 300 ) {
				delete_option( $lock_name );
			}
			if ( ! add_option( $lock_name, $lock, '', false ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_locked',
					'Another request is preparing this immutable asset.',
					423,
					array( 'assetId' => $asset['assetId'] )
				);
			}
		}
		try {
			return $this->prepare_one_unlocked( $artifact_id, $asset );
		} finally {
			$current_lock = get_option( $lock_name, array() );
			if ( is_array( $current_lock ) && isset( $current_lock['token'] ) && hash_equals( (string) $current_lock['token'], (string) $lock['token'] ) ) {
				delete_option( $lock_name );
			}
		}
	}

	private function prepare_one_unlocked( $artifact_id, $asset ) {
		$existing = $this->get_binding( $asset['assetId'] );
		if ( null !== $existing ) {
			if ( ! hash_equals( $existing['byteHash'], $asset['byteHash'] ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_identity_conflict',
					'The immutable asset ID is already bound to different bytes.',
					409,
					array(
						'assetId'          => $asset['assetId'],
						'registeredHash'   => $existing['byteHash'],
						'requestedHash'    => $asset['byteHash'],
						'attachmentId'     => $existing['attachmentId'],
					)
				);
			}
			$this->associate_artifact( $existing['attachmentId'], $artifact_id );
			$existing['reused'] = true;
			return $existing;
		}

		$attachment_id = $this->find_attachment_by_asset_id( $asset['assetId'] );
		if ( $attachment_id ) {
			$stored_hash = (string) get_post_meta( $attachment_id, self::META_BYTE_HASH, true );
			if ( ! hash_equals( $stored_hash, $asset['byteHash'] ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_identity_conflict',
					'The immutable asset ID is already attached with different bytes.',
					409,
					array(
						'assetId'        => $asset['assetId'],
						'registeredHash' => $stored_hash,
						'requestedHash'  => $asset['byteHash'],
						'attachmentId'   => $attachment_id,
					)
				);
			}
			$binding = $this->binding_from_attachment( $attachment_id, $asset['assetId'], $stored_hash, true );
			$this->store_binding( $binding );
			$this->associate_artifact( $attachment_id, $artifact_id );
			return $binding;
		}

		$temp_file = $this->download( $asset['sourceUrl'] );
		try {
			$actual_hash = hash_file( 'sha256', $temp_file );
			if ( false === $actual_hash || ! hash_equals( $asset['byteHash'], $actual_hash ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_byte_hash_mismatch',
					'Downloaded asset bytes do not match byteHash.',
					422,
					array(
						'assetId'      => $asset['assetId'],
						'expectedHash' => $asset['byteHash'],
						'actualHash'   => false === $actual_hash ? null : $actual_hash,
					)
				);
			}
			$actual_bytes = filesize( $temp_file );
			if ( false === $actual_bytes || (int) $asset['bytes'] !== (int) $actual_bytes ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_size_mismatch',
					'Downloaded asset byte length does not match the immutable manifest.',
					422,
					array(
						'assetId'       => $asset['assetId'],
						'expectedBytes' => $asset['bytes'],
						'actualBytes'   => false === $actual_bytes ? null : $actual_bytes,
					)
				);
			}

			$filename = $this->filename( $asset );
			$file     = array(
				'name'     => $filename,
				'tmp_name' => $temp_file,
			);
			$this->load_media_dependencies();
			$attachment_id = media_handle_sideload( $file, 0, null, array( 'post_title' => pathinfo( $filename, PATHINFO_FILENAME ) ) );
			if ( is_wp_error( $attachment_id ) ) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_upload_failed',
					'WordPress rejected the prepared asset: ' . $attachment_id->get_error_message(),
					422,
					array( 'assetId' => $asset['assetId'] )
				);
			}
			// WordPress moved the temporary file into uploads.
			$temp_file = null;
			$actual_mime = (string) get_post_mime_type( $attachment_id );
			if ( '' !== $asset['mimeType'] && strtolower( $asset['mimeType'] ) !== strtolower( $actual_mime ) ) {
				wp_delete_attachment( $attachment_id, true );
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_mime_mismatch',
					'WordPress media type does not match the immutable manifest.',
					422,
					array(
						'assetId'     => $asset['assetId'],
						'expectedMime'=> $asset['mimeType'],
						'actualMime'  => $actual_mime,
					)
				);
			}
			$attached_file = get_attached_file( $attachment_id );
			$stored_hash   = is_string( $attached_file ) && is_file( $attached_file ) ? hash_file( 'sha256', $attached_file ) : false;
			if ( false === $stored_hash || ! hash_equals( $asset['byteHash'], $stored_hash ) ) {
				wp_delete_attachment( $attachment_id, true );
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_byte_hash_mismatch',
					'Stored WordPress attachment bytes do not match byteHash.',
					422,
					array(
						'assetId'      => $asset['assetId'],
						'expectedHash' => $asset['byteHash'],
						'actualHash'   => false === $stored_hash ? null : $stored_hash,
					)
				);
			}

			$metadata_written =
				false !== update_post_meta( $attachment_id, self::META_ASSET_ID, $asset['assetId'] ) &&
				false !== update_post_meta( $attachment_id, self::META_BYTE_HASH, $asset['byteHash'] ) &&
				false !== update_post_meta( $attachment_id, self::META_SOURCE_URL, esc_url_raw( $asset['sourceUrl'] ) );
			if ( ! $metadata_written ) {
				wp_delete_attachment( $attachment_id, true );
				throw new SiteForge_Runtime_Exception(
					'siteforge_asset_metadata_failed',
					'WordPress could not persist immutable asset metadata.',
					500,
					array( 'assetId' => $asset['assetId'] )
				);
			}

			if ( is_string( $asset['altText'] ) && '' !== $asset['altText'] ) {
				update_post_meta( $attachment_id, '_wp_attachment_image_alt', sanitize_text_field( $asset['altText'] ) );
			}
			if ( is_string( $asset['caption'] ) && '' !== $asset['caption'] ) {
				wp_update_post(
					array(
						'ID'           => $attachment_id,
						'post_excerpt' => wp_kses_post( $asset['caption'] ),
					)
				);
			}
			$this->associate_artifact( $attachment_id, $artifact_id );

			$binding = $this->binding_from_attachment( $attachment_id, $asset['assetId'], $asset['byteHash'], false );
			$this->store_binding( $binding );
			return $binding;
		} finally {
			if ( is_string( $temp_file ) && file_exists( $temp_file ) ) {
				wp_delete_file( $temp_file );
			}
		}
	}

	private function download( $url ) {
		$this->load_media_dependencies();
		$temp_file = download_url( $url, 60 );
		if ( is_wp_error( $temp_file ) ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_asset_download_failed',
				'WordPress could not download the asset: ' . $temp_file->get_error_message(),
				422
			);
		}
		$size = filesize( $temp_file );
		if ( false === $size || $size < 1 || $size > wp_max_upload_size() ) {
			wp_delete_file( $temp_file );
			throw new SiteForge_Runtime_Exception(
				'siteforge_asset_size_invalid',
				'Asset is empty or exceeds the WordPress upload limit.',
				413,
				array(
					'bytes'    => false === $size ? null : $size,
					'maxBytes' => wp_max_upload_size(),
				)
			);
		}
		return $temp_file;
	}

	private function filename( $asset ) {
		$filename = $asset['filename'];
		if ( '' === $filename ) {
			$path     = (string) wp_parse_url( $asset['sourceUrl'], PHP_URL_PATH );
			$filename = basename( $path );
		}
		$filename = sanitize_file_name( $filename );
		if ( '' === $filename ) {
			$filename = 'siteforge-' . $asset['assetId'] . '.bin';
		}
		return $filename;
	}

	private function find_attachment_by_asset_id( $asset_id ) {
		$query = new WP_Query(
			array(
				'post_type'              => 'attachment',
				'post_status'            => 'inherit',
				'posts_per_page'         => 2,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
				'meta_key'               => self::META_ASSET_ID,
				'meta_value'             => $asset_id,
			)
		);
		if ( count( $query->posts ) > 1 ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_asset_binding_corrupt',
				'Multiple WordPress attachments claim the same immutable asset ID.',
				409,
				array( 'assetId' => $asset_id )
			);
		}
		return empty( $query->posts ) ? 0 : absint( $query->posts[0] );
	}

	private function binding_from_attachment( $attachment_id, $asset_id, $byte_hash, $reused ) {
		$url = wp_get_attachment_url( $attachment_id );
		if ( ! is_string( $url ) || '' === $url ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_asset_url_missing',
				'Prepared WordPress attachment has no public URL.',
				500,
				array( 'attachmentId' => absint( $attachment_id ) )
			);
		}
		return array(
			'assetId'      => $asset_id,
			'byteHash'     => $byte_hash,
			'attachmentId' => absint( $attachment_id ),
			'url'          => $url,
			'mimeType'     => (string) get_post_mime_type( $attachment_id ),
			'reused'       => (bool) $reused,
		);
	}

	private function associate_artifact( $attachment_id, $artifact_id ) {
		$artifacts = get_post_meta( $attachment_id, self::META_ARTIFACTS, true );
		$artifacts = is_array( $artifacts ) ? $artifacts : array();
		if ( ! in_array( $artifact_id, $artifacts, true ) ) {
			$artifacts[] = $artifact_id;
			sort( $artifacts, SORT_STRING );
			update_post_meta( $attachment_id, self::META_ARTIFACTS, $artifacts );
		}
	}

	private function store_binding( $binding ) {
		$registry = $this->registry();
		$stored   = $binding;
		unset( $stored['reused'] );
		$registry[ $binding['assetId'] ] = $stored;
		ksort( $registry, SORT_STRING );
		if ( false === update_option( self::REGISTRY_OPTION, $registry, false ) && $registry !== get_option( self::REGISTRY_OPTION, array() ) ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_asset_registry_failed',
				'WordPress could not persist the asset binding registry.',
				500,
				array( 'assetId' => $binding['assetId'] )
			);
		}
	}

	private function registry() {
		$registry = get_option( self::REGISTRY_OPTION, array() );
		return is_array( $registry ) ? $registry : array();
	}

	private function load_media_dependencies() {
		if ( ! function_exists( 'download_url' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( ! function_exists( 'media_handle_sideload' ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}
	}
}

