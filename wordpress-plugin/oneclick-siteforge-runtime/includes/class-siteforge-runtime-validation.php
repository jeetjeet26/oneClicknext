<?php
/**
 * Dependency-free validation and canonical hashing for the SiteForge v2 contract.
 *
 * @package OneClick_SiteForge_Runtime
 */

if ( ! class_exists( 'SiteForge_Runtime_Validation_Exception' ) ) {
	class SiteForge_Runtime_Validation_Exception extends RuntimeException {
		/** @var string */
		private $siteforge_code;

		/** @var array */
		private $details;

		public function __construct( $siteforge_code, $message, $details = array() ) {
			parent::__construct( $message );
			$this->siteforge_code = $siteforge_code;
			$this->details        = $details;
		}

		public function get_siteforge_code() {
			return $this->siteforge_code;
		}

		public function get_details() {
			return $this->details;
		}
	}
}

if ( ! class_exists( 'SiteForge_Runtime_Exception' ) ) {
	class SiteForge_Runtime_Exception extends RuntimeException {
		/** @var string */
		private $siteforge_code;

		/** @var int */
		private $http_status;

		/** @var array */
		private $details;

		public function __construct( $siteforge_code, $message, $http_status = 500, $details = array(), $previous = null ) {
			parent::__construct( $message, 0, $previous );
			$this->siteforge_code = $siteforge_code;
			$this->http_status    = $http_status;
			$this->details        = $details;
		}

		public function get_siteforge_code() {
			return $this->siteforge_code;
		}

		public function get_http_status() {
			return $this->http_status;
		}

		public function get_details() {
			return $this->details;
		}
	}
}

class SiteForge_Runtime_Validation {
	const HASH_PATTERN = '/^[a-f0-9]{64}$/';
	const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
	const KEY_PATTERN  = '/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/';
	const BLOCK_VARIANTS = array(
		'acf/menu'               => array( 'standard', 'sticky-cta' ),
		'acf/top-slides'         => array( 'cinematic', 'editorial', 'split', 'panoramic', 'immersive', 'minimal' ),
		'acf/text-section'       => array( 'editorial', 'contained', 'lead' ),
		'acf/feature-section'    => array( 'alternating', 'bleed', 'framed', 'spotlight', 'collage', 'compact' ),
		'acf/image'              => array( 'full-bleed', 'contained' ),
		'acf/links'              => array( 'inline', 'banner', 'sticky' ),
		'acf/content-grid'       => array( 'amenity-grid', 'tabs', 'editorial', 'bento', 'icon-list', 'carousel' ),
		'acf/form'               => array( 'card', 'split', 'minimal' ),
		'acf/map'                => array( 'standard', 'immersive', 'centered' ),
		'acf/html-section'       => array( 'contained', 'full-width' ),
		'acf/gallery'            => array( 'categorized', 'masonry', 'lightbox', 'filmstrip', 'mosaic', 'full-bleed' ),
		'acf/accordion-section'  => array( 'bordered', 'minimal' ),
		'acf/plans-availability' => array( 'cards', 'details', 'preleasing' ),
		'acf/poi'                => array( 'narrative', 'map-list', 'editorial' ),
		'acf/testimonials'       => array( 'cards', 'spotlight', 'carousel' ),
		'acf/governed-component' => array( 'governed' ),
	);

	/**
	 * Validate a prepare-assets request without mutating the supplied payload.
	 */
	public static function asset_request( $value ) {
		self::assert_object( $value, 'body' );
		self::contract_version( $value );
		self::reject_unknown_keys(
			$value,
			array( 'contractVersion', 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'idempotencyKey', 'assets' ),
			'body'
		);

		$site_id       = self::required_key( $value, 'siteId' );
		$artifact_id   = self::required_uuid( $value, 'artifactId' );
		$content_hash  = self::required_hash( $value, 'artifactContentHash' );
		$manifest_hash = self::required_hash( $value, 'assetManifestHash' );
		$idempotency   = self::required_hash( $value, 'idempotencyKey' );
		$assets      = isset( $value['assets'] ) ? $value['assets'] : null;
		if ( ! is_array( $assets ) || ( ! empty( $assets ) && self::is_associative( $assets ) ) || count( $assets ) > 100 ) {
			self::invalid( 'assets', 'assets must be a list containing no more than 100 entries.' );
		}

		$seen       = array();
		$normalized = array();
		foreach ( $assets as $index => $asset ) {
			self::assert_object( $asset, 'assets[' . $index . ']' );
			self::reject_unknown_keys(
				$asset,
				array( 'assetId', 'sourceUrl', 'byteHash', 'bytes', 'mimeType', 'filename', 'role', 'altText', 'caption' ),
				'assets[' . $index . ']'
			);
			$asset_id  = self::required_uuid( $asset, 'assetId', 'assets[' . $index . '].' );
			$byte_hash = self::required_hash( $asset, 'byteHash', 'assets[' . $index . '].' );
			$source    = self::required_string( $asset, 'sourceUrl', PHP_INT_MAX, 'assets[' . $index . '].' );
			if ( false === filter_var( $source, FILTER_VALIDATE_URL ) ) {
				self::invalid( 'assets[' . $index . '].sourceUrl', 'Asset sourceUrl must be a URL.' );
			}
			if ( isset( $seen[ $asset_id ] ) ) {
				self::invalid( 'assets[' . $index . '].assetId', 'Each immutable assetId may appear only once.' );
			}
			$seen[ $asset_id ] = true;

			$filename = self::required_string( $asset, 'filename', 255, 'assets[' . $index . '].' );
			if ( false !== strpos( $filename, '/' ) || false !== strpos( $filename, '\\' ) ) {
				self::invalid( 'assets[' . $index . '].filename', 'Asset filename must not contain a path.' );
			}
			$bytes = isset( $asset['bytes'] ) ? self::bounded_integer( $asset['bytes'], 1, PHP_INT_MAX, 'assets[' . $index . '].bytes' ) : null;

			$normalized[] = array(
				'assetId'    => $asset_id,
				'sourceUrl'  => $source,
				'byteHash'   => strtolower( $byte_hash ),
				'bytes'      => $bytes,
				'mimeType'   => self::required_string( $asset, 'mimeType', 100, 'assets[' . $index . '].' ),
				'filename'   => $filename,
				'role'       => self::required_string( $asset, 'role', 100, 'assets[' . $index . '].' ),
				'altText'    => array_key_exists( 'altText', $asset ) && null !== $asset['altText'] ? self::plain_string( $asset['altText'], 2000, 'assets[' . $index . '].altText' ) : null,
				'caption'    => array_key_exists( 'caption', $asset ) && null !== $asset['caption'] ? self::plain_string( $asset['caption'], 10000, 'assets[' . $index . '].caption' ) : null,
			);
		}

		$identities = array_map(
			static function ( $asset ) {
				unset( $asset['sourceUrl'] );
				return $asset;
			},
			$normalized
		);
		usort(
			$identities,
			static function ( $left, $right ) {
				return strcmp( $left['assetId'], $right['assetId'] );
			}
		);
		$actual_manifest_hash = self::hash( $identities );
		if ( ! hash_equals( $manifest_hash, $actual_manifest_hash ) ) {
			self::mismatch( 'siteforge_asset_manifest_hash_mismatch', 'assetManifestHash', $manifest_hash, $actual_manifest_hash );
		}
		$actual_idempotency = self::idempotency_hash( 'asset_preparation', $site_id, $artifact_id, $content_hash, null, $manifest_hash );
		if ( ! hash_equals( $idempotency, $actual_idempotency ) ) {
			self::mismatch( 'siteforge_idempotency_hash_mismatch', 'idempotencyKey', $idempotency, $actual_idempotency );
		}

		return array(
			'contractVersion' => 2,
			'siteId'          => $site_id,
			'artifactId'      => strtolower( $artifact_id ),
			'artifactContentHash'=> $content_hash,
			'assetManifestHash'=> $manifest_hash,
			'idempotencyKey'  => $idempotency,
			'assets'          => $normalized,
		);
	}

	/**
	 * Validate one desired-state deployment request.
	 */
	public static function deployment_request( $value ) {
		self::assert_object( $value, 'body' );
		self::contract_version( $value );
		self::reject_unknown_keys(
			$value,
			array( 'contractVersion', 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'operationHash', 'idempotencyKey', 'expectedRemoteContentHash', 'assetPreparationId', 'plan' ),
			'body'
		);

		$site_id       = self::required_key( $value, 'siteId' );
		$artifact_id   = self::required_uuid( $value, 'artifactId' );
		$content_hash  = self::required_hash( $value, 'artifactContentHash' );
		$idempotency   = self::required_hash( $value, 'idempotencyKey' );
		$preparation_id= self::required_key( $value, 'assetPreparationId' );
		$manifest_hash = self::required_hash( $value, 'assetManifestHash' );
		$operation_hash= self::required_hash( $value, 'operationHash' );
		if ( ! array_key_exists( 'expectedRemoteContentHash', $value ) ) {
			self::invalid( 'expectedRemoteContentHash', 'expectedRemoteContentHash is required and may be null for an empty target.' );
		}
		$expected_hash = $value['expectedRemoteContentHash'];
		if ( null !== $expected_hash && ! self::is_hash( $expected_hash ) ) {
			self::invalid( 'expectedRemoteContentHash', 'expectedRemoteContentHash must be a lowercase SHA-256 hash or null.' );
		}

		$plan = isset( $value['plan'] ) ? $value['plan'] : null;
		self::assert_object( $plan, 'plan' );
		$plan = self::plan( $plan );
		$hash_plan = $plan;
		foreach ( array( 'legal', 'analytics' ) as $record_key ) {
			if ( isset( $hash_plan[ $record_key ] ) && array() === $hash_plan[ $record_key ] ) {
				$hash_plan[ $record_key ] = (object) array();
			}
		}
		foreach ( $hash_plan['pages'] as &$hash_page ) {
			foreach ( $hash_page['sections'] as &$hash_section ) {
				if ( array() === $hash_section['data'] ) {
					$hash_section['data'] = (object) array();
				}
			}
			unset( $hash_section );
		}
		unset( $hash_page );
		$actual_operation_hash = self::hash( $hash_plan );
		if ( ! hash_equals( $operation_hash, $actual_operation_hash ) ) {
			self::mismatch( 'siteforge_operation_hash_mismatch', 'operationHash', $operation_hash, $actual_operation_hash );
		}
		$actual_idempotency = self::idempotency_hash( 'deployment', $site_id, $artifact_id, $content_hash, $expected_hash, $operation_hash );
		if ( ! hash_equals( $idempotency, $actual_idempotency ) ) {
			self::mismatch( 'siteforge_idempotency_hash_mismatch', 'idempotencyKey', $idempotency, $actual_idempotency );
		}

		return array(
			'contractVersion'          => 2,
			'siteId'                   => $site_id,
			'artifactId'               => strtolower( $artifact_id ),
			'artifactContentHash'      => $content_hash,
			'operationHash'            => $operation_hash,
			'idempotencyKey'           => $idempotency,
			'expectedRemoteContentHash'=> $expected_hash,
			'assetPreparationId'       => $preparation_id,
			'assetManifestHash'        => $manifest_hash,
			'plan'                     => $plan,
		);
	}

	public static function plan( $plan ) {
		$allowed = array(
			'pages',
			'removals',
			'navigation',
			'designTokens',
			'siteSettings',
			'legal',
			'analytics',
			'siteConfiguration',
			'target',
			'publicRuntime',
			'protection',
		);
		self::reject_unknown_keys( $plan, $allowed, 'plan' );
		foreach ( array( 'pages', 'removals', 'navigation', 'designTokens', 'siteSettings', 'legal', 'analytics' ) as $required_key ) {
			if ( ! array_key_exists( $required_key, $plan ) ) {
				self::invalid( 'plan.' . $required_key, $required_key . ' is required.' );
			}
		}

		$pages = $plan['pages'];
		if ( ! is_array( $pages ) || ( ! empty( $pages ) && self::is_associative( $pages ) ) || count( $pages ) > 200 ) {
			self::invalid( 'plan.pages', 'pages must be a list containing no more than 200 entries.' );
		}

		$seen_pages       = array();
		$normalized_pages = array();
		foreach ( $pages as $index => $page ) {
			self::assert_object( $page, 'plan.pages[' . $index . ']' );
			self::reject_unknown_keys(
				$page,
				array( 'pageKey', 'slug', 'title', 'purpose', 'status', 'menuOrder', 'template', 'excerpt', 'seo', 'sections' ),
				'plan.pages[' . $index . ']'
			);
			$key   = self::required_key( $page, 'pageKey', 'plan.pages[' . $index . '].' );
			$slug  = self::required_slug( $page, 'slug', 'plan.pages[' . $index . '].' );
			$title = self::required_string( $page, 'title', 500, 'plan.pages[' . $index . '].' );
			if ( isset( $seen_pages[ $key ] ) || isset( $seen_pages[ 'slug:' . $slug ] ) ) {
				self::invalid( 'plan.pages[' . $index . ']', 'pageKey and slug must be unique within the plan.' );
			}
			$seen_pages[ $key ]            = true;
			$seen_pages[ 'slug:' . $slug ] = true;
			foreach ( array( 'purpose', 'status', 'menuOrder', 'template', 'excerpt', 'seo', 'sections' ) as $required ) {
				if ( ! array_key_exists( $required, $page ) ) {
					self::invalid( 'plan.pages[' . $index . '].' . $required, $required . ' is required.' );
				}
			}
			$status = $page['status'];
			if ( ! in_array( $status, array( 'publish', 'draft', 'private' ), true ) ) {
				self::invalid( 'plan.pages[' . $index . '].status', 'Page status must be publish, draft, or private.' );
			}
			$purpose = self::plain_string( $page['purpose'], 10000, 'plan.pages[' . $index . '].purpose' );
			$seo     = $page['seo'];
			$sections= $page['sections'];
			self::validate_seo( $seo, 'plan.pages[' . $index . '].seo' );
			if ( ! is_array( $sections ) || ( ! empty( $sections ) && self::is_associative( $sections ) ) ) {
				self::invalid( 'plan.pages[' . $index . '].sections', 'Page sections must be a list.' );
			}
			$normalized_sections = array();
			foreach ( $sections as $section_index => $section ) {
				$section_path = 'plan.pages[' . $index . '].sections[' . $section_index . ']';
				self::assert_object( $section, $section_path );
				self::reject_unknown_keys( $section, array( 'sectionId', 'blockName', 'order', 'variant', 'cssClasses', 'anchor', 'align', 'data' ), $section_path );
				foreach ( array( 'sectionId', 'blockName', 'order', 'variant', 'data' ) as $required ) {
					if ( ! array_key_exists( $required, $section ) ) {
						self::invalid( $section_path . '.' . $required, $required . ' is required.' );
					}
				}
				$section_id = self::required_key( $section, 'sectionId', $section_path . '.' );
				$block_name = self::required_string( $section, 'blockName', 200, $section_path . '.' );
				if ( ! isset( self::BLOCK_VARIANTS[ $block_name ] ) ) {
					self::invalid( $section_path . '.blockName', 'Only registered SiteForge ACF blocks are supported.' );
				}
				$order = self::bounded_integer( $section['order'], 0, PHP_INT_MAX, $section_path . '.order' );
				if ( null !== $section['variant'] && ( ! is_string( $section['variant'] ) || '' === $section['variant'] ) ) {
					self::invalid( $section_path . '.variant', 'variant must be a non-empty string or null.' );
				}
				if ( null !== $section['variant'] && ! in_array( $section['variant'], self::BLOCK_VARIANTS[ $block_name ], true ) ) {
					self::invalid( $section_path . '.variant', 'variant is not supported by the selected block.' );
				}
				self::assert_object( $section['data'], $section_path . '.data' );
				$normalized_section = array(
					'sectionId' => $section_id,
					'blockName' => $block_name,
					'order'     => $order,
					'variant'   => null === $section['variant'] ? null : self::plain_string( $section['variant'], 100000, $section_path . '.variant' ),
					'data'      => self::normalize_json_value( $section['data'], $section_path . '.data', 0 ),
				);
				if ( array_key_exists( 'cssClasses', $section ) ) {
					$normalized_section['cssClasses'] = self::css_class_list( $section['cssClasses'], $section_path . '.cssClasses' );
				}
				if ( array_key_exists( 'anchor', $section ) ) {
					$normalized_section['anchor'] = self::required_key( $section, 'anchor', $section_path . '.' );
				}
				if ( array_key_exists( 'align', $section ) ) {
					self::enum( $section['align'], array( 'wide', 'full' ), $section_path . '.align' );
					$normalized_section['align'] = $section['align'];
				}
				$normalized_sections[] = $normalized_section;
			}
			$normalized_pages[] = array(
				'pageKey'   => $key,
				'slug'      => $slug,
				'title'     => $title,
				'purpose'   => $purpose,
				'status'    => $status,
				'menuOrder' => self::bounded_integer( $page['menuOrder'], 0, PHP_INT_MAX, 'plan.pages[' . $index . '].menuOrder' ),
				'template'  => self::plain_string( $page['template'], 255, 'plan.pages[' . $index . '].template' ),
				'excerpt'   => self::plain_string( $page['excerpt'], 10000, 'plan.pages[' . $index . '].excerpt' ),
				'seo'       => $seo,
				'sections'  => $normalized_sections,
			);
		}

		$removals = $plan['removals'];
		self::assert_object( $removals, 'plan.removals' );
		self::reject_unknown_keys( $removals, array( 'pageKeys', 'pageSlugs' ), 'plan.removals' );
		$normalized_removals = array(
			'pageKeys'  => self::string_list( isset( $removals['pageKeys'] ) ? $removals['pageKeys'] : null, 200, 'plan.removals.pageKeys', 'key' ),
			'pageSlugs' => self::string_list( isset( $removals['pageSlugs'] ) ? $removals['pageSlugs'] : null, 200, 'plan.removals.pageSlugs', 'slug' ),
		);

		$normalized = array(
			'pages'    => $normalized_pages,
			'removals' => $normalized_removals,
		);

		foreach ( array( 'navigation', 'designTokens', 'siteSettings', 'legal', 'analytics' ) as $key ) {
			self::assert_object( $plan[ $key ], 'plan.' . $key );
			$normalized[ $key ] = self::normalize_json_value( $plan[ $key ], 'plan.' . $key, 0 );
		}

		self::validate_site_settings( $normalized['siteSettings'] );
		self::validate_design_tokens( $normalized['designTokens'] );
		self::validate_navigation( $normalized['navigation'] );
		if ( array_key_exists( 'siteConfiguration', $plan ) ) {
			self::assert_object( $plan['siteConfiguration'], 'plan.siteConfiguration' );
			$normalized['siteConfiguration'] = self::normalize_json_value( $plan['siteConfiguration'], 'plan.siteConfiguration', 0 );
			self::validate_site_configuration( $normalized['siteConfiguration'] );
		}
		if ( array_key_exists( 'target', $plan ) ) {
			self::assert_object( $plan['target'], 'plan.target' );
			$normalized['target'] = self::normalize_json_value( $plan['target'], 'plan.target', 0 );
			self::validate_target_state( $normalized['target'] );
		}
		if ( array_key_exists( 'publicRuntime', $plan ) ) {
			self::assert_object( $plan['publicRuntime'], 'plan.publicRuntime' );
			$normalized['publicRuntime'] = self::normalize_json_value( $plan['publicRuntime'], 'plan.publicRuntime', 0 );
			self::validate_public_runtime( $normalized['publicRuntime'] );
		}
		if ( array_key_exists( 'protection', $plan ) ) {
			self::assert_object( $plan['protection'], 'plan.protection' );
			$normalized['protection'] = self::normalize_json_value( $plan['protection'], 'plan.protection', 0 );
			self::validate_protection_state( $normalized['protection'] );
		}
		if ( empty( $normalized['siteSettings']['homepagePageKey'] ) || ! isset( $seen_pages[ $normalized['siteSettings']['homepagePageKey'] ] ) ) {
			self::invalid( 'plan.siteSettings.homepagePageKey', 'homepagePageKey must reference a desired page.' );
		}
		foreach ( $normalized_removals['pageKeys'] as $page_key ) {
			if ( isset( $seen_pages[ $page_key ] ) ) {
				self::invalid( 'plan.removals.pageKeys', 'A desired page cannot also be removed.' );
			}
		}
		foreach ( $normalized_removals['pageSlugs'] as $slug ) {
			if ( isset( $seen_pages[ 'slug:' . $slug ] ) ) {
				self::invalid( 'plan.removals.pageSlugs', 'A desired page cannot also be removed.' );
			}
		}

		return $normalized;
	}

	/**
	 * Validate authoritative v2 response fixtures without WordPress dependencies.
	 */
	public static function response_fixture( $kind, $value ) {
		self::assert_object( $value, $kind );
		switch ( $kind ) {
			case 'health':
				self::exact_keys( $value, array( 'contractVersion', 'runtimeVersion', 'status', 'checkedAt', 'dependencies' ), $kind );
				self::contract_version( $value );
				self::required_string( $value, 'runtimeVersion', PHP_INT_MAX, $kind . '.' );
				self::enum( $value['status'], array( 'ok', 'degraded', 'unavailable' ), $kind . '.status' );
				self::datetime( $value['checkedAt'], $kind . '.checkedAt' );
				self::list_value( $value['dependencies'], $kind . '.dependencies' );
				foreach ( $value['dependencies'] as $index => $dependency ) {
					self::assert_object( $dependency, $kind . '.dependencies[' . $index . ']' );
					self::reject_unknown_keys( $dependency, array( 'name', 'status', 'message' ), $kind . '.dependencies[' . $index . ']' );
					self::required_string( $dependency, 'name', PHP_INT_MAX, $kind . '.dependencies[' . $index . '].' );
					self::enum( isset( $dependency['status'] ) ? $dependency['status'] : null, array( 'ok', 'degraded', 'unavailable' ), $kind . '.dependencies[' . $index . '].status' );
					if ( isset( $dependency['message'] ) ) {
						self::required_string( $dependency, 'message', PHP_INT_MAX, $kind . '.dependencies[' . $index . '].' );
					}
				}
				break;
			case 'capabilities':
				self::exact_keys( $value, array( 'contractVersion', 'runtimeVersion', 'provider', 'authentication', 'features', 'limits' ), $kind );
				self::contract_version( $value );
				self::required_string( $value, 'runtimeVersion', PHP_INT_MAX, $kind . '.' );
				if ( 'wordpress' !== $value['provider'] || 'wordpress_application_password' !== $value['authentication'] ) {
					self::invalid( $kind, 'Provider or authentication capability is invalid.' );
				}
				$features = array( 'immutableAssetPreparation', 'optimisticConcurrency', 'idempotentDeployments', 'transactionalRollback', 'pageRemovals', 'navigationMutation', 'designTokenMutation', 'siteSettingsMutation', 'legalMutation', 'analyticsMutation' );
				self::exact_keys( $value['features'], $features, $kind . '.features' );
				foreach ( $features as $feature ) {
					if ( true !== $value['features'][ $feature ] ) {
						self::invalid( $kind . '.features.' . $feature, 'Required runtime features must be true.' );
					}
				}
				self::exact_keys( $value['limits'], array( 'maxAssetsPerPreparation', 'maxAssetBytes', 'maxPagesPerDeployment', 'acceptedAssetMimeTypes' ), $kind . '.limits' );
				foreach ( array( 'maxAssetsPerPreparation', 'maxAssetBytes', 'maxPagesPerDeployment' ) as $limit ) {
					self::bounded_integer( $value['limits'][ $limit ], 1, PHP_INT_MAX, $kind . '.limits.' . $limit );
				}
				self::string_list( $value['limits']['acceptedAssetMimeTypes'], PHP_INT_MAX, $kind . '.limits.acceptedAssetMimeTypes', 'text' );
				break;
			case 'asset-preparation-result':
				self::exact_keys( $value, array( 'contractVersion', 'preparationId', 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'idempotencyKey', 'assets', 'preparedAt' ), $kind );
				self::contract_version( $value );
				self::required_key( $value, 'preparationId', $kind . '.' );
				self::required_key( $value, 'siteId', $kind . '.' );
				self::required_uuid( $value, 'artifactId', $kind . '.' );
				foreach ( array( 'artifactContentHash', 'assetManifestHash', 'idempotencyKey' ) as $hash ) {
					self::required_hash( $value, $hash, $kind . '.' );
				}
				self::list_value( $value['assets'], $kind . '.assets' );
				foreach ( $value['assets'] as $index => $asset ) {
					self::exact_keys( $asset, array( 'assetId', 'byteHash', 'attachmentId', 'url', 'mimeType', 'disposition' ), $kind . '.assets[' . $index . ']' );
					self::required_uuid( $asset, 'assetId', $kind . '.assets[' . $index . '].' );
					self::required_hash( $asset, 'byteHash', $kind . '.assets[' . $index . '].' );
					self::bounded_integer( $asset['attachmentId'], 1, PHP_INT_MAX, $kind . '.assets[' . $index . '].attachmentId' );
					self::url( $asset['url'], $kind . '.assets[' . $index . '].url' );
					self::required_string( $asset, 'mimeType', PHP_INT_MAX, $kind . '.assets[' . $index . '].' );
					self::enum( $asset['disposition'], array( 'created', 'reused' ), $kind . '.assets[' . $index . '].disposition' );
				}
				self::datetime( $value['preparedAt'], $kind . '.preparedAt' );
				break;
			case 'state':
				self::exact_keys( $value, array( 'contractVersion', 'runtimeVersion', 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'operationHash', 'transactionId', 'pageIds', 'mediaBindings', 'updatedAt' ), $kind );
				self::contract_version( $value );
				self::required_string( $value, 'runtimeVersion', PHP_INT_MAX, $kind . '.' );
				self::required_key( $value, 'siteId', $kind . '.' );
				self::nullable_uuid( $value['artifactId'], $kind . '.artifactId' );
				foreach ( array( 'artifactContentHash', 'assetManifestHash', 'operationHash' ) as $hash ) {
					self::nullable_hash( $value[ $hash ], $kind . '.' . $hash );
				}
				self::nullable_uuid( $value['transactionId'], $kind . '.transactionId' );
				self::record_ids( $value['pageIds'], $kind . '.pageIds' );
				self::media_bindings( $value['mediaBindings'], $kind . '.mediaBindings' );
				self::nullable_datetime( $value['updatedAt'], $kind . '.updatedAt' );
				break;
			case 'deployment-status':
				self::exact_keys( $value, array( 'contractVersion', 'transactionId', 'status', 'phase', 'siteId', 'artifactId', 'artifactContentHash', 'assetManifestHash', 'operationHash', 'idempotencyKey', 'expectedRemoteContentHash', 'previousRemoteContentHash', 'appliedContentHash', 'runtimeVersion', 'pageIds', 'mediaBindings', 'rollback', 'verification', 'submittedAt', 'startedAt', 'completedAt', 'idempotentReplay', 'failure' ), $kind );
				self::contract_version( $value );
				self::required_uuid( $value, 'transactionId', $kind . '.' );
				self::enum( $value['status'], array( 'running', 'succeeded', 'failed' ), $kind . '.status' );
				self::enum( $value['phase'], array( 'preflight', 'pages', 'settings', 'navigation', 'removals', 'verification', 'manifest', 'rollback', 'complete' ), $kind . '.phase' );
				self::required_key( $value, 'siteId', $kind . '.' );
				self::required_uuid( $value, 'artifactId', $kind . '.' );
				foreach ( array( 'artifactContentHash', 'assetManifestHash', 'operationHash', 'idempotencyKey' ) as $hash ) {
					self::required_hash( $value, $hash, $kind . '.' );
				}
				foreach ( array( 'expectedRemoteContentHash', 'previousRemoteContentHash', 'appliedContentHash' ) as $hash ) {
					self::nullable_hash( $value[ $hash ], $kind . '.' . $hash );
				}
				self::required_string( $value, 'runtimeVersion', PHP_INT_MAX, $kind . '.' );
				self::record_ids( $value['pageIds'], $kind . '.pageIds' );
				self::media_bindings( $value['mediaBindings'], $kind . '.mediaBindings' );
				self::rollback( $value['rollback'], $kind . '.rollback' );
				if ( null !== $value['verification'] ) {
					self::verification( $value['verification'], $kind . '.verification' );
				}
				self::datetime( $value['submittedAt'], $kind . '.submittedAt' );
				self::nullable_datetime( $value['startedAt'], $kind . '.startedAt' );
				self::nullable_datetime( $value['completedAt'], $kind . '.completedAt' );
				if ( ! is_bool( $value['idempotentReplay'] ) ) {
					self::invalid( $kind . '.idempotentReplay', 'idempotentReplay must be boolean.' );
				}
				if ( null !== $value['failure'] ) {
					self::failure( $value['failure'], $kind . '.failure' );
				}
				if ( 'succeeded' === $value['status'] && ( 'complete' !== $value['phase'] || $value['appliedContentHash'] !== $value['artifactContentHash'] || null === $value['completedAt'] || null === $value['verification'] || true !== $value['verification']['verified'] || null !== $value['failure'] ) ) {
					self::invalid( $kind, 'Succeeded deployment result is internally inconsistent.' );
				}
				if ( 'failed' === $value['status'] && null === $value['failure'] ) {
					self::invalid( $kind . '.failure', 'Failed deployments require a failure.' );
				}
				break;
			case 'error':
				self::reject_unknown_keys( $value, array( 'contractVersion', 'error', 'requestId' ), $kind );
				if ( isset( $value['contractVersion'] ) ) {
					self::contract_version( $value );
				}
				if ( ! isset( $value['error'] ) ) {
					self::invalid( $kind . '.error', 'error is required.' );
				}
				self::failure( $value['error'], $kind . '.error' );
				if ( isset( $value['requestId'] ) ) {
					self::required_string( $value, 'requestId', PHP_INT_MAX, $kind . '.' );
				}
				break;
			default:
				self::invalid( $kind, 'Unknown response fixture kind.' );
		}
		return $value;
	}

	public static function hash( $value ) {
		return hash( 'sha256', self::canonical_json( $value ) );
	}

	public static function canonical_json( $value ) {
		$normalized = self::sort_for_hash( $value );
		$json       = json_encode( $normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		if ( false === $json ) {
			throw new SiteForge_Runtime_Validation_Exception( 'siteforge_json_encoding_failed', 'Unable to encode canonical JSON.' );
		}
		return $json;
	}

	public static function is_hash( $value ) {
		return is_string( $value ) && 1 === preg_match( self::HASH_PATTERN, $value );
	}

	private static function validate_seo( $seo, $path ) {
		if ( null === $seo ) {
			return;
		}
		self::assert_object( $seo, $path );
		self::reject_unknown_keys( $seo, array( 'title', 'description', 'canonicalPath', 'noIndex', 'structuredData' ), $path );
		foreach ( array( 'title', 'description', 'canonicalPath', 'noIndex', 'structuredData' ) as $required ) {
			if ( ! array_key_exists( $required, $seo ) ) {
				self::invalid( $path . '.' . $required, $required . ' is required.' );
			}
		}
		self::required_string( $seo, 'title', 500, $path . '.' );
		self::plain_string( $seo['description'], 10000, $path . '.description' );
		$canonical_path = self::plain_string( $seo['canonicalPath'], 2048, $path . '.canonicalPath' );
		if ( ! preg_match( '#^/(?:[A-Za-z0-9._~!$&\'()*+,;=:@%\-]+/?)*$#', $canonical_path ) ) {
			self::invalid( $path . '.canonicalPath', 'canonicalPath must be root-relative without a query or fragment.' );
		}
		if ( ! is_bool( $seo['noIndex'] ) ) {
			self::invalid( $path . '.noIndex', 'noIndex must be boolean.' );
		}
		$structured_data = self::string_list( $seo['structuredData'], 100, $path . '.structuredData', 'text', true );
		foreach ( $structured_data as $index => $json_ld ) {
			$decoded = json_decode( $json_ld, true );
			if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $decoded ) ) {
				self::invalid( $path . '.structuredData[' . $index . ']', 'Structured data must contain a JSON object or array.' );
			}
		}
	}

	private static function validate_operation( $operation, $index ) {
		$payload = $operation['payload'];
		$path    = 'plan.operations[' . $index . '].payload';
		switch ( $operation['kind'] ) {
			case 'apply_theme':
				self::reject_unknown_keys( $payload, array( 'baseThemePackageSha256', 'overlayPackageSha256', 'overlayContentHash' ), $path );
				self::required_hash( $payload, 'baseThemePackageSha256', $path . '.' );
				foreach ( array( 'overlayPackageSha256', 'overlayContentHash' ) as $key ) {
					if ( ! array_key_exists( $key, $payload ) || ( null !== $payload[ $key ] && ! self::is_hash( $payload[ $key ] ) ) ) {
						self::invalid( $path . '.' . $key, $key . ' must be SHA-256 or null.' );
					}
				}
				break;
			case 'upsert_page':
				self::reject_unknown_keys( $payload, array( 'slug', 'title', 'purpose', 'status', 'seo', 'blocks' ), $path );
				self::required_slug( $payload, 'slug', $path . '.' );
				self::required_string( $payload, 'title', 500, $path . '.' );
				if ( ! isset( $payload['purpose'] ) || ! is_string( $payload['purpose'] ) || strlen( $payload['purpose'] ) > 10000 ) {
					self::invalid( $path . '.purpose', 'Page purpose must be a string.' );
				}
				if ( ! isset( $payload['status'] ) || ! in_array( $payload['status'], array( 'publish', 'draft', 'private' ), true ) ) {
					self::invalid( $path . '.status', 'Compiled page status is invalid.' );
				}
				if ( ! array_key_exists( 'seo', $payload ) || ( null !== $payload['seo'] && ! is_array( $payload['seo'] ) ) ) {
					self::invalid( $path . '.seo', 'Page SEO must be an object or null.' );
				}
				if ( is_array( $payload['seo'] ) ) {
					self::reject_unknown_keys( $payload['seo'], array( 'title', 'description', 'canonicalPath', 'noIndex', 'structuredData' ), $path . '.seo' );
					foreach ( array( 'title', 'description', 'canonicalPath' ) as $key ) {
						if ( ! isset( $payload['seo'][ $key ] ) || ! is_string( $payload['seo'][ $key ] ) ) {
							self::invalid( $path . '.seo.' . $key, 'SEO text fields must be strings.' );
						}
					}
					if ( ! isset( $payload['seo']['noIndex'] ) || ! is_bool( $payload['seo']['noIndex'] ) ) {
						self::invalid( $path . '.seo.noIndex', 'noIndex must be boolean.' );
					}
					self::string_list( isset( $payload['seo']['structuredData'] ) ? $payload['seo']['structuredData'] : null, 100, $path . '.seo.structuredData', 'text' );
				}
				if ( ! isset( $payload['blocks'] ) || ! is_array( $payload['blocks'] ) || ( ! empty( $payload['blocks'] ) && self::is_associative( $payload['blocks'] ) ) ) {
					self::invalid( $path . '.blocks', 'Page blocks must be a list.' );
				}
				foreach ( $payload['blocks'] as $block_index => $block ) {
					self::assert_object( $block, $path . '.blocks[' . $block_index . ']' );
					self::reject_unknown_keys( $block, array( 'sectionId', 'name', 'order', 'variant', 'data' ), $path . '.blocks[' . $block_index . ']' );
					self::required_string( $block, 'sectionId', 200, $path . '.blocks[' . $block_index . '].' );
					$block_name = self::required_string( $block, 'name', 200, $path . '.blocks[' . $block_index . '].' );
					if ( ! preg_match( '#^acf/[a-z0-9-]+$#', $block_name ) ) {
						self::invalid( $path . '.blocks[' . $block_index . '].name', 'Only normalized ACF block names are supported.' );
					}
					if ( ! isset( $block['order'] ) || ! is_int( $block['order'] ) || $block['order'] < 0 ) {
						self::invalid( $path . '.blocks[' . $block_index . '].order', 'Block order must be nonnegative.' );
					}
					if ( ! array_key_exists( 'variant', $block ) || ( null !== $block['variant'] && ( ! is_string( $block['variant'] ) || '' === $block['variant'] ) ) ) {
						self::invalid( $path . '.blocks[' . $block_index . '].variant', 'Block variant must be a string or null.' );
					}
					self::assert_object( $block['data'], $path . '.blocks[' . $block_index . '].data' );
					self::normalize_json_value( $block['data'], $path . '.blocks[' . $block_index . '].data', 0 );
				}
				break;
			case 'update_site_settings':
				self::reject_unknown_keys( $payload, array( 'siteName', 'tagline', 'logoAssetId', 'homepageSlug', 'siteConfiguration' ), $path );
				self::required_string( $payload, 'siteName', 500, $path . '.' );
				if ( ! isset( $payload['tagline'] ) || ! is_string( $payload['tagline'] ) || strlen( $payload['tagline'] ) > 2000 ) {
					self::invalid( $path . '.tagline', 'Tagline must be a string.' );
				}
				foreach ( array( 'logoAssetId', 'homepageSlug' ) as $key ) {
					if ( ! array_key_exists( $key, $payload ) || ( null !== $payload[ $key ] && ( ! is_string( $payload[ $key ] ) || '' === $payload[ $key ] ) ) ) {
						self::invalid( $path . '.' . $key, $key . ' must be a non-empty string or null.' );
					}
				}
				if ( ! array_key_exists( 'siteConfiguration', $payload ) || ( null !== $payload['siteConfiguration'] && ! is_array( $payload['siteConfiguration'] ) ) ) {
					self::invalid( $path . '.siteConfiguration', 'siteConfiguration must be an object or null.' );
				}
				if ( is_array( $payload['siteConfiguration'] ) ) {
					self::reject_unknown_keys(
						$payload['siteConfiguration'],
						array( 'design', 'header', 'navigation', 'footer', 'media', 'motion', 'behavior' ),
						$path . '.siteConfiguration'
					);
					self::normalize_json_value( $payload['siteConfiguration'], $path . '.siteConfiguration', 0 );
					if ( isset( $payload['siteConfiguration']['design'] ) ) {
						self::validate_design_tokens( $payload['siteConfiguration']['design'] );
					}
				}
				break;
			case 'replace_navigation':
				self::reject_unknown_keys( $payload, array( 'location', 'items' ), $path );
				self::required_key( $payload, 'location', $path . '.' );
				if ( ! isset( $payload['items'] ) || ! is_array( $payload['items'] ) || ( ! empty( $payload['items'] ) && self::is_associative( $payload['items'] ) ) ) {
					self::invalid( $path . '.items', 'Navigation items must be a list.' );
				}
				foreach ( $payload['items'] as $item_index => $item ) {
					self::assert_object( $item, $path . '.items[' . $item_index . ']' );
					self::reject_unknown_keys( $item, array( 'label', 'href', 'pageSlug' ), $path . '.items[' . $item_index . ']' );
					self::required_string( $item, 'label', 500, $path . '.items[' . $item_index . '].' );
					$href = self::required_string( $item, 'href', 2048, $path . '.items[' . $item_index . '].' );
					if ( 0 !== strpos( $href, '/' ) && ( false === filter_var( $href, FILTER_VALIDATE_URL ) || ! in_array( strtolower( (string) parse_url( $href, PHP_URL_SCHEME ) ), array( 'http', 'https' ), true ) ) ) {
						self::invalid( $path . '.items[' . $item_index . '].href', 'Navigation href must be site-relative or HTTP(S).' );
					}
					if ( ! array_key_exists( 'pageSlug', $item ) || ( null !== $item['pageSlug'] && ! is_string( $item['pageSlug'] ) ) ) {
						self::invalid( $path . '.items[' . $item_index . '].pageSlug', 'pageSlug must be a string or null.' );
					}
				}
				break;
			case 'commit_content':
				self::reject_unknown_keys( $payload, array( 'desiredContentHash', 'assetManifestHash', 'pageSlugs' ), $path );
				self::required_hash( $payload, 'desiredContentHash', $path . '.' );
				self::required_hash( $payload, 'assetManifestHash', $path . '.' );
				self::string_list( isset( $payload['pageSlugs'] ) ? $payload['pageSlugs'] : null, 200, $path . '.pageSlugs', 'slug' );
				break;
		}
	}

	private static function idempotency_hash( $scope, $site_id, $artifact_id, $artifact_content_hash, $expected_hash, $payload_hash ) {
		return self::hash(
			array(
				'contractVersion'          => 2,
				'scope'                    => $scope,
				'siteId'                   => $site_id,
				'artifactId'               => $artifact_id,
				'artifactContentHash'      => $artifact_content_hash,
				'expectedRemoteContentHash'=> $expected_hash,
				'payloadHash'              => $payload_hash,
			)
		);
	}

	private static function mismatch( $code, $path, $expected, $actual ) {
		throw new SiteForge_Runtime_Validation_Exception(
			$code,
			$path . ' does not match its canonical payload.',
			array(
				'path'     => $path,
				'expected' => $expected,
				'actual'   => $actual,
			)
		);
	}

	private static function validate_site_settings( $settings ) {
		$allowed = array( 'siteName', 'tagline', 'homepagePageKey', 'logoAssetId', 'faviconAssetId', 'propertyProfile' );
		self::reject_unknown_keys( $settings, $allowed, 'plan.siteSettings' );
		self::required_string( $settings, 'siteName', 500, 'plan.siteSettings.' );
		if ( ! array_key_exists( 'tagline', $settings ) || ! is_string( $settings['tagline'] ) || strlen( $settings['tagline'] ) > 2000 ) {
			self::invalid( 'plan.siteSettings.tagline', 'Tagline must be a string.' );
		}
		self::required_key( $settings, 'homepagePageKey', 'plan.siteSettings.' );
		foreach ( array( 'logoAssetId', 'faviconAssetId' ) as $key ) {
			if ( ! array_key_exists( $key, $settings ) ) {
				self::invalid( 'plan.siteSettings.' . $key, $key . ' is required and may be null.' );
			}
			if ( null !== $settings[ $key ] ) {
				self::required_uuid( $settings, $key, 'plan.siteSettings.' );
			}
		}
		if ( isset( $settings['propertyProfile'] ) ) {
			self::assert_object( $settings['propertyProfile'], 'plan.siteSettings.propertyProfile' );
			self::reject_unknown_keys(
				$settings['propertyProfile'],
				array( 'name', 'address', 'phone', 'email', 'socialLinks' ),
				'plan.siteSettings.propertyProfile'
			);
			self::required_string( $settings['propertyProfile'], 'name', 500, 'plan.siteSettings.propertyProfile.' );
			foreach ( array( 'address' => 2000, 'phone' => 100, 'email' => 320 ) as $key => $maximum ) {
				if ( ! array_key_exists( $key, $settings['propertyProfile'] ) || ! is_string( $settings['propertyProfile'][ $key ] ) || strlen( $settings['propertyProfile'][ $key ] ) > $maximum ) {
					self::invalid( 'plan.siteSettings.propertyProfile.' . $key, $key . ' must be a bounded string.' );
				}
			}
			self::assert_object( $settings['propertyProfile']['socialLinks'], 'plan.siteSettings.propertyProfile.socialLinks' );
		}
	}

	private static function validate_design_tokens( $tokens ) {
		$allowed = array( 'colors', 'typography', 'spacing' );
		self::reject_unknown_keys( $tokens, $allowed, 'plan.designTokens' );
		if ( ! isset( $tokens['colors'], $tokens['typography'], $tokens['spacing'] ) ) {
			self::invalid( 'plan.designTokens', 'designTokens requires colors, typography, and spacing.' );
		}
		foreach ( array( 'colors', 'typography', 'spacing' ) as $key ) {
			self::assert_object( $tokens[ $key ], 'plan.designTokens.' . $key );
		}
		self::reject_unknown_keys( $tokens['colors'], array( 'primary', 'secondary', 'accent', 'background', 'text' ), 'plan.designTokens.colors' );
		self::reject_unknown_keys( $tokens['typography'], array( 'headingFont', 'bodyFont', 'headingWeight' ), 'plan.designTokens.typography' );
		self::reject_unknown_keys( $tokens['spacing'], array( 'containerMaxWidth', 'sectionPadding' ), 'plan.designTokens.spacing' );
		foreach ( array( 'primary', 'secondary', 'accent', 'background', 'text' ) as $color ) {
			if ( ! isset( $tokens['colors'][ $color ] ) || ! is_string( $tokens['colors'][ $color ] ) || '' === $tokens['colors'][ $color ] ) {
				self::invalid( 'plan.designTokens.colors.' . $color, 'Required colors must be non-empty strings.' );
			}
		}
		foreach ( array( 'headingFont', 'bodyFont' ) as $font ) {
			if ( empty( $tokens['typography'][ $font ] ) || ! is_string( $tokens['typography'][ $font ] ) ) {
				self::invalid( 'plan.designTokens.typography.' . $font, 'Font stacks must be non-empty strings.' );
			}
		}
		if (
			! isset( $tokens['typography']['headingWeight'] ) ||
			! is_int( $tokens['typography']['headingWeight'] ) ||
			$tokens['typography']['headingWeight'] < 100 ||
			$tokens['typography']['headingWeight'] > 900
		) {
			self::invalid( 'plan.designTokens.typography.headingWeight', 'headingWeight must be an integer from 100 through 900.' );
		}
		foreach ( array( 'containerMaxWidth', 'sectionPadding' ) as $dimension ) {
			if ( ! isset( $tokens['spacing'][ $dimension ] ) || ! is_string( $tokens['spacing'][ $dimension ] ) || '' === $tokens['spacing'][ $dimension ] ) {
				self::invalid( 'plan.designTokens.spacing.' . $dimension, 'Spacing values must be non-empty strings.' );
			}
		}
	}

	private static function validate_navigation( $navigation ) {
		self::reject_unknown_keys( $navigation, array( 'location', 'name', 'items' ), 'plan.navigation' );
		self::required_key( $navigation, 'location', 'plan.navigation.' );
		self::required_string( $navigation, 'name', 200, 'plan.navigation.' );
		$items = isset( $navigation['items'] ) ? $navigation['items'] : null;
		if ( ! is_array( $items ) || ( ! empty( $items ) && self::is_associative( $items ) ) || count( $items ) > 200 ) {
			self::invalid( 'plan.navigation.items', 'Navigation items must be a list containing no more than 200 entries.' );
		}
		$item_keys = array();
		foreach ( $items as $index => $item ) {
			self::assert_object( $item, 'plan.navigation.items[' . $index . ']' );
			self::reject_unknown_keys( $item, array( 'itemKey', 'label', 'pageKey', 'url', 'parentItemKey', 'target' ), 'plan.navigation.items[' . $index . ']' );
			foreach ( array( 'itemKey', 'label', 'pageKey', 'url', 'parentItemKey', 'target' ) as $required ) {
				if ( ! array_key_exists( $required, $item ) ) {
					self::invalid( 'plan.navigation.items[' . $index . '].' . $required, $required . ' is required.' );
				}
			}
			$item_key = self::required_key( $item, 'itemKey', 'plan.navigation.items[' . $index . '].' );
			if ( isset( $item_keys[ $item_key ] ) ) {
				self::invalid( 'plan.navigation.items[' . $index . '].itemKey', 'Navigation item keys must be unique.' );
			}
			$item_keys[ $item_key ] = $index;
			self::required_string( $item, 'label', 500, 'plan.navigation.items[' . $index . '].' );
			$has_page = null !== $item['pageKey'];
			$has_url  = null !== $item['url'];
			if ( $has_page === $has_url ) {
				self::invalid( 'plan.navigation.items[' . $index . ']', 'Each navigation item must declare exactly one pageKey or URL.' );
			}
			if ( $has_page ) {
				self::required_key( $item, 'pageKey', 'plan.navigation.items[' . $index . '].' );
			}
			if ( $has_url ) {
				$url = self::required_string( $item, 'url', 2048, 'plan.navigation.items[' . $index . '].' );
				if ( 0 !== strpos( $url, '/' ) && ( false === filter_var( $url, FILTER_VALIDATE_URL ) || ! in_array( strtolower( (string) parse_url( $url, PHP_URL_SCHEME ) ), array( 'http', 'https' ), true ) ) ) {
					self::invalid( 'plan.navigation.items[' . $index . '].url', 'Navigation URLs must be root-relative or HTTP(S).' );
				}
			}
			if ( ! array_key_exists( 'parentItemKey', $item ) || ( null !== $item['parentItemKey'] && ( ! is_string( $item['parentItemKey'] ) || ! preg_match( self::KEY_PATTERN, $item['parentItemKey'] ) ) ) ) {
				self::invalid( 'plan.navigation.items[' . $index . '].parentItemKey', 'parentItemKey must be a runtime ID or null.' );
			}
			if ( ! isset( $item['target'] ) || ! in_array( $item['target'], array( '_self', '_blank' ), true ) ) {
				self::invalid( 'plan.navigation.items[' . $index . '].target', 'Navigation target is invalid.' );
			}
		}
		$parents = array();
		foreach ( $items as $index => $item ) {
			$item_key  = $item['itemKey'];
			$parent_key = $item['parentItemKey'];
			if ( null !== $parent_key && ! isset( $item_keys[ $parent_key ] ) ) {
				self::invalid( 'plan.navigation.items[' . $index . '].parentItemKey', 'Navigation parents must reference another item.' );
			}
			$parents[ $item_key ] = $parent_key;
		}
		foreach ( $items as $index => $item ) {
			$visited = array();
			$cursor  = $item['itemKey'];
			while ( null !== $cursor ) {
				if ( isset( $visited[ $cursor ] ) ) {
					self::invalid( 'plan.navigation.items[' . $index . '].parentItemKey', 'Navigation hierarchy must not contain cycles.' );
				}
				$visited[ $cursor ] = true;
				$cursor = isset( $parents[ $cursor ] ) ? $parents[ $cursor ] : null;
			}
		}
	}

	private static function validate_site_configuration( $configuration ) {
		$path = 'plan.siteConfiguration';
		self::exact_keys( $configuration, array( 'design', 'header', 'navigation', 'footer', 'media', 'motion', 'behavior' ), $path );
		self::assert_object( $configuration['design'], $path . '.design' );
		self::validate_design_tokens( $configuration['design'] );

		$header = $configuration['header'];
		self::exact_keys( $header, array( 'layout', 'position', 'announcement', 'cta' ), $path . '.header' );
		self::enum( $header['layout'], array( 'logo-left', 'logo-center', 'split' ), $path . '.header.layout' );
		self::enum( $header['position'], array( 'static', 'sticky', 'overlay' ), $path . '.header.position' );
		self::assert_object( $header['announcement'], $path . '.header.announcement' );
		self::reject_unknown_keys( $header['announcement'], array( 'enabled', 'text', 'link' ), $path . '.header.announcement' );
		if ( ! array_key_exists( 'enabled', $header['announcement'] ) || ! is_bool( $header['announcement']['enabled'] ) ) {
			self::invalid( $path . '.header.announcement.enabled', 'enabled must be boolean.' );
		}
		if ( ! array_key_exists( 'text', $header['announcement'] ) ) {
			self::invalid( $path . '.header.announcement.text', 'text is required.' );
		}
		self::plain_string( $header['announcement']['text'], 10000, $path . '.header.announcement.text' );
		if ( isset( $header['announcement']['link'] ) ) {
			self::url_or_path( $header['announcement']['link'], $path . '.header.announcement.link' );
		}
		self::exact_keys( $header['cta'], array( 'enabled', 'label', 'href' ), $path . '.header.cta' );
		if ( ! is_bool( $header['cta']['enabled'] ) ) {
			self::invalid( $path . '.header.cta.enabled', 'enabled must be boolean.' );
		}
		self::required_string( $header['cta'], 'label', 500, $path . '.header.cta.' );
		self::url_or_path( $header['cta']['href'], $path . '.header.cta.href' );

		$navigation = $configuration['navigation'];
		self::exact_keys( $navigation, array( 'style', 'items' ), $path . '.navigation' );
		self::enum( $navigation['style'], array( 'horizontal', 'mega', 'drawer' ), $path . '.navigation.style' );
		self::list_value( $navigation['items'], $path . '.navigation.items' );
		foreach ( $navigation['items'] as $index => $item ) {
			$item_path = $path . '.navigation.items[' . $index . ']';
			self::assert_object( $item, $item_path );
			self::reject_unknown_keys( $item, array( 'id', 'label', 'href', 'parentId', 'external' ), $item_path );
			self::required_string( $item, 'id', 200, $item_path . '.' );
			self::required_string( $item, 'label', 500, $item_path . '.' );
			self::url_or_path( isset( $item['href'] ) ? $item['href'] : null, $item_path . '.href' );
			if ( isset( $item['parentId'] ) ) {
				self::required_string( $item, 'parentId', 200, $item_path . '.' );
			}
			if ( isset( $item['external'] ) && ! is_bool( $item['external'] ) ) {
				self::invalid( $item_path . '.external', 'external must be boolean.' );
			}
		}

		$footer = $configuration['footer'];
		self::assert_object( $footer, $path . '.footer' );
		self::reject_unknown_keys( $footer, array( 'layout', 'showNavigation', 'showContact', 'showSocial', 'tagline' ), $path . '.footer' );
		foreach ( array( 'layout', 'showNavigation', 'showContact', 'showSocial' ) as $required ) {
			if ( ! array_key_exists( $required, $footer ) ) {
				self::invalid( $path . '.footer.' . $required, $required . ' is required.' );
			}
		}
		self::enum( $footer['layout'], array( 'compact', 'columns', 'editorial' ), $path . '.footer.layout' );
		foreach ( array( 'showNavigation', 'showContact', 'showSocial' ) as $boolean ) {
			if ( ! is_bool( $footer[ $boolean ] ) ) {
				self::invalid( $path . '.footer.' . $boolean, $boolean . ' must be boolean.' );
			}
		}
		if ( isset( $footer['tagline'] ) ) {
			self::plain_string( $footer['tagline'], 2000, $path . '.footer.tagline' );
		}

		$media = $configuration['media'];
		self::assert_object( $media, $path . '.media' );
		self::reject_unknown_keys( $media, array( 'logoAssetId', 'logoUrl', 'logoAlt', 'faviconAssetId', 'faviconUrl', 'defaultImageUrl', 'imageTreatment' ), $path . '.media' );
		if ( ! isset( $media['imageTreatment'] ) ) {
			self::invalid( $path . '.media.imageTreatment', 'imageTreatment is required.' );
		}
		self::enum( $media['imageTreatment'], array( 'natural', 'rounded', 'editorial', 'full-bleed' ), $path . '.media.imageTreatment' );
		foreach ( array( 'logoAssetId', 'faviconAssetId' ) as $asset_key ) {
			if ( isset( $media[ $asset_key ] ) && ( ! is_string( $media[ $asset_key ] ) || ! preg_match( self::UUID_PATTERN, $media[ $asset_key ] ) ) ) {
				self::invalid( $path . '.media.' . $asset_key, $asset_key . ' must be a UUID.' );
			}
		}
		foreach ( array( 'logoUrl', 'faviconUrl', 'defaultImageUrl' ) as $url_key ) {
			if ( isset( $media[ $url_key ] ) ) {
				self::url_or_path( $media[ $url_key ], $path . '.media.' . $url_key );
			}
		}
		if ( isset( $media['logoAlt'] ) ) {
			self::plain_string( $media['logoAlt'], 2000, $path . '.media.logoAlt' );
		}

		$motion = $configuration['motion'];
		self::exact_keys( $motion, array( 'level', 'reducedMotion', 'reveal', 'durationMs', 'easing' ), $path . '.motion' );
		self::enum( $motion['level'], array( 'none', 'subtle', 'prominent' ), $path . '.motion.level' );
		self::enum( $motion['reducedMotion'], array( 'respect', 'disable' ), $path . '.motion.reducedMotion' );
		self::enum( $motion['reveal'], array( 'none', 'fade', 'slide', 'scale' ), $path . '.motion.reveal' );
		self::bounded_integer( $motion['durationMs'], 0, 5000, $path . '.motion.durationMs' );
		self::enum( $motion['easing'], array( 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out' ), $path . '.motion.easing' );

		$behavior = $configuration['behavior'];
		self::exact_keys( $behavior, array( 'smoothScroll', 'externalLinksNewTab', 'backToTop', 'cookieConsent' ), $path . '.behavior' );
		foreach ( array( 'smoothScroll', 'externalLinksNewTab', 'backToTop' ) as $boolean ) {
			if ( ! is_bool( $behavior[ $boolean ] ) ) {
				self::invalid( $path . '.behavior.' . $boolean, $boolean . ' must be boolean.' );
			}
		}
		self::enum( $behavior['cookieConsent'], array( 'disabled', 'informational', 'required' ), $path . '.behavior.cookieConsent' );
	}

	private static function validate_target_state( $target ) {
		self::exact_keys( $target, array( 'mode', 'siteUrl' ), 'plan.target' );
		self::enum( $target['mode'], array( 'canonical_preview', 'staging', 'production' ), 'plan.target.mode' );
		self::url( $target['siteUrl'], 'plan.target.siteUrl' );
	}

	private static function validate_public_runtime( $runtime ) {
		self::exact_keys( $runtime, array( 'enabled', 'apiKey', 'apiBaseUrl', 'websiteId', 'conversionEndpoint', 'conversionKey', 'telemetryEndpoint' ), 'plan.publicRuntime' );
		if ( ! is_bool( $runtime['enabled'] ) ) {
			self::invalid( 'plan.publicRuntime.enabled', 'enabled must be boolean.' );
		}
		foreach ( array( 'apiKey', 'conversionKey' ) as $key ) {
			if ( ! is_string( $runtime[ $key ] ) || strlen( $runtime[ $key ] ) > 2000 ) {
				self::invalid( 'plan.publicRuntime.' . $key, $key . ' must be a bounded string.' );
			}
		}
		if ( '' === $runtime['conversionKey'] || ( $runtime['enabled'] && '' === $runtime['apiKey'] ) ) {
			self::invalid( 'plan.publicRuntime', 'Public runtime identity is incomplete.' );
		}
		if ( ! is_string( $runtime['websiteId'] ) || ! preg_match( self::UUID_PATTERN, $runtime['websiteId'] ) ) {
			self::invalid( 'plan.publicRuntime.websiteId', 'websiteId must be a UUID.' );
		}
		foreach ( array( 'apiBaseUrl', 'conversionEndpoint', 'telemetryEndpoint' ) as $key ) {
			self::url( $runtime[ $key ], 'plan.publicRuntime.' . $key );
			if ( 'https' !== strtolower( (string) parse_url( $runtime[ $key ], PHP_URL_SCHEME ) ) ) {
				self::invalid( 'plan.publicRuntime.' . $key, 'Public runtime URLs must use HTTPS.' );
			}
		}
	}

	private static function validate_protection_state( $protection ) {
		self::exact_keys( $protection, array( 'mode' ), 'plan.protection' );
		self::enum( $protection['mode'], array( 'noindex', 'password_noindex', 'public' ), 'plan.protection.mode' );
	}

	private static function css_class_list( $value, $path ) {
		self::list_value( $value, $path );
		if ( count( $value ) > 20 ) {
			self::invalid( $path, 'No more than 20 CSS classes are allowed.' );
		}
		$output = array();
		foreach ( $value as $index => $class_name ) {
			if ( ! is_string( $class_name ) || strlen( $class_name ) > 120 || ! preg_match( '/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/', $class_name ) ) {
				self::invalid( $path . '[' . $index . ']', 'CSS classes must be plain class identifiers.' );
			}
			$output[] = $class_name;
		}
		return $output;
	}

	private static function url_or_path( $value, $path ) {
		if ( ! is_string( $value ) || '' === $value || ( 0 !== strpos( $value, '/' ) && ! preg_match( '#^https?://#i', $value ) ) ) {
			self::invalid( $path, 'Value must be an absolute URL or root-relative path.' );
		}
	}

	private static function normalize_json_value( $value, $path, $depth ) {
		if ( is_array( $value ) ) {
			$output = array();
			foreach ( $value as $key => $item ) {
				$output[ $key ] = self::normalize_json_value( $item, $path . '.' . $key, $depth + 1 );
			}
			return $output;
		}
		if ( is_string( $value ) ) {
			return $value;
		}
		if ( is_int( $value ) || is_float( $value ) || is_bool( $value ) || null === $value ) {
			return $value;
		}
		self::invalid( $path, 'Value must be JSON-compatible.' );
	}

	private static function sort_for_hash( $value ) {
		if ( is_object( $value ) ) {
			$properties = get_object_vars( $value );
			ksort( $properties, SORT_STRING );
			foreach ( $properties as $key => $item ) {
				$properties[ $key ] = self::sort_for_hash( $item );
			}
			return (object) $properties;
		}
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( self::is_associative( $value ) ) {
			ksort( $value, SORT_STRING );
		}
		foreach ( $value as $key => $item ) {
			$value[ $key ] = self::sort_for_hash( $item );
		}
		return $value;
	}

	private static function exact_keys( $value, $keys, $path ) {
		self::assert_object( $value, $path );
		self::reject_unknown_keys( $value, $keys, $path );
		foreach ( $keys as $key ) {
			if ( ! array_key_exists( $key, $value ) ) {
				self::invalid( $path . '.' . $key, $key . ' is required.' );
			}
		}
	}

	private static function enum( $value, $allowed, $path ) {
		if ( ! is_string( $value ) || ! in_array( $value, $allowed, true ) ) {
			self::invalid( $path, 'Value is not an allowed contract enum member.' );
		}
	}

	private static function list_value( $value, $path ) {
		if ( ! is_array( $value ) || ( ! empty( $value ) && self::is_associative( $value ) ) ) {
			self::invalid( $path, 'Value must be a JSON list.' );
		}
	}

	private static function datetime( $value, $path ) {
		if ( ! is_string( $value ) || false === DateTimeImmutable::createFromFormat( DATE_ATOM, $value ) ) {
			self::invalid( $path, 'Value must be an ISO-8601 datetime with offset.' );
		}
	}

	private static function nullable_datetime( $value, $path ) {
		if ( null !== $value ) {
			self::datetime( $value, $path );
		}
	}

	private static function url( $value, $path ) {
		if ( ! is_string( $value ) || false === filter_var( $value, FILTER_VALIDATE_URL ) ) {
			self::invalid( $path, 'Value must be a URL.' );
		}
	}

	private static function nullable_hash( $value, $path ) {
		if ( null !== $value && ! self::is_hash( $value ) ) {
			self::invalid( $path, 'Value must be a lowercase SHA-256 hash or null.' );
		}
	}

	private static function nullable_uuid( $value, $path ) {
		if ( null !== $value && ( ! is_string( $value ) || ! preg_match( self::UUID_PATTERN, $value ) ) ) {
			self::invalid( $path, 'Value must be a UUID or null.' );
		}
	}

	private static function record_ids( $value, $path ) {
		if ( ! is_array( $value ) && ! is_object( $value ) ) {
			self::invalid( $path, 'Value must be an object of runtime IDs.' );
		}
		foreach ( (array) $value as $key => $id ) {
			if ( ! is_string( $key ) || ! preg_match( self::KEY_PATTERN, $key ) ) {
				self::invalid( $path, 'Record key must be a runtime ID.' );
			}
			self::bounded_integer( $id, 1, PHP_INT_MAX, $path . '.' . $key );
		}
	}

	private static function media_bindings( $value, $path ) {
		if ( ! is_array( $value ) && ! is_object( $value ) ) {
			self::invalid( $path, 'mediaBindings must be an object.' );
		}
		foreach ( (array) $value as $asset_id => $binding ) {
			if ( ! preg_match( self::UUID_PATTERN, (string) $asset_id ) ) {
				self::invalid( $path, 'mediaBindings keys must be UUIDs.' );
			}
			self::exact_keys( $binding, array( 'attachmentId', 'url', 'byteHash', 'mimeType' ), $path . '.' . $asset_id );
			self::bounded_integer( $binding['attachmentId'], 1, PHP_INT_MAX, $path . '.' . $asset_id . '.attachmentId' );
			self::url( $binding['url'], $path . '.' . $asset_id . '.url' );
			if ( ! self::is_hash( $binding['byteHash'] ) ) {
				self::invalid( $path . '.' . $asset_id . '.byteHash', 'byteHash must be SHA-256.' );
			}
			self::required_string( $binding, 'mimeType', PHP_INT_MAX, $path . '.' . $asset_id . '.' );
		}
	}

	private static function verification( $value, $path ) {
		self::exact_keys( $value, array( 'verified', 'checks', 'verifiedAt' ), $path );
		if ( ! is_bool( $value['verified'] ) ) {
			self::invalid( $path . '.verified', 'verified must be boolean.' );
		}
		self::list_value( $value['checks'], $path . '.checks' );
		foreach ( $value['checks'] as $index => $check ) {
			self::exact_keys( $check, array( 'name', 'passed', 'message' ), $path . '.checks[' . $index . ']' );
			self::required_string( $check, 'name', PHP_INT_MAX, $path . '.checks[' . $index . '].' );
			if ( ! is_bool( $check['passed'] ) ) {
				self::invalid( $path . '.checks[' . $index . '].passed', 'passed must be boolean.' );
			}
			self::required_string( $check, 'message', PHP_INT_MAX, $path . '.checks[' . $index . '].' );
		}
		self::nullable_datetime( $value['verifiedAt'], $path . '.verifiedAt' );
	}

	private static function rollback( $value, $path ) {
		self::exact_keys( $value, array( 'attempted', 'succeeded', 'restoredContentHash', 'failure' ), $path );
		if ( ! is_bool( $value['attempted'] ) || ( null !== $value['succeeded'] && ! is_bool( $value['succeeded'] ) ) ) {
			self::invalid( $path, 'Rollback booleans are invalid.' );
		}
		self::nullable_hash( $value['restoredContentHash'], $path . '.restoredContentHash' );
		if ( null !== $value['failure'] ) {
			self::failure( $value['failure'], $path . '.failure' );
		}
	}

	private static function failure( $value, $path ) {
		self::assert_object( $value, $path );
		self::reject_unknown_keys( $value, array( 'code', 'message', 'retryable', 'stage', 'operationHash', 'expectedRemoteContentHash', 'actualRemoteContentHash', 'details' ), $path );
		foreach ( array( 'code', 'message', 'retryable' ) as $required ) {
			if ( ! array_key_exists( $required, $value ) ) {
				self::invalid( $path . '.' . $required, $required . ' is required.' );
			}
		}
		self::enum( $value['code'], array( 'unauthorized', 'forbidden', 'unsupported_contract', 'capability_mismatch', 'stale_remote_state', 'idempotency_conflict', 'invalid_artifact', 'invalid_asset', 'asset_hash_mismatch', 'invalid_plan', 'operation_failed', 'deployment_not_found', 'runtime_unavailable', 'rate_limited', 'internal_error', 'invalid_response' ), $path . '.code' );
		self::required_string( $value, 'message', PHP_INT_MAX, $path . '.' );
		if ( ! is_bool( $value['retryable'] ) ) {
			self::invalid( $path . '.retryable', 'retryable must be boolean.' );
		}
		if ( isset( $value['stage'] ) ) {
			self::enum( $value['stage'], array( 'authentication', 'health', 'capabilities', 'state', 'asset_preparation', 'preflight', 'pages', 'settings', 'navigation', 'removals', 'verification', 'manifest', 'rollback' ), $path . '.stage' );
		}
		if ( isset( $value['operationHash'] ) && ! self::is_hash( $value['operationHash'] ) ) {
			self::invalid( $path . '.operationHash', 'operationHash must be SHA-256.' );
		}
		foreach ( array( 'expectedRemoteContentHash', 'actualRemoteContentHash' ) as $hash ) {
			if ( array_key_exists( $hash, $value ) ) {
				self::nullable_hash( $value[ $hash ], $path . '.' . $hash );
			}
		}
		if ( isset( $value['details'] ) ) {
			self::assert_object( $value['details'], $path . '.details' );
		}
	}

	private static function contract_version( $value ) {
		if ( ! isset( $value['contractVersion'] ) || 2 !== $value['contractVersion'] ) {
			self::invalid( 'contractVersion', 'contractVersion must be the integer 2.' );
		}
	}

	private static function required_hash( $value, $key, $prefix = '' ) {
		if ( ! isset( $value[ $key ] ) || ! self::is_hash( $value[ $key ] ) ) {
			self::invalid( $prefix . $key, $key . ' must be a lowercase SHA-256 hash.' );
		}
		return $value[ $key ];
	}

	private static function required_uuid( $value, $key, $prefix = '' ) {
		if ( ! isset( $value[ $key ] ) || ! is_string( $value[ $key ] ) || ! preg_match( self::UUID_PATTERN, $value[ $key ] ) ) {
			self::invalid( $prefix . $key, $key . ' must be a UUID.' );
		}
		return $value[ $key ];
	}

	private static function required_key( $value, $key, $prefix = '' ) {
		$output = self::required_string( $value, $key, 200, $prefix );
		if ( ! preg_match( self::KEY_PATTERN, $output ) ) {
			self::invalid( $prefix . $key, $key . ' contains unsupported characters.' );
		}
		return $output;
	}

	private static function required_slug( $value, $key, $prefix = '' ) {
		$output = self::required_string( $value, $key, 200, $prefix );
		if ( ! preg_match( '/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $output ) ) {
			self::invalid( $prefix . $key, $key . ' must be a normalized URL slug.' );
		}
		return $output;
	}

	private static function required_string( $value, $key, $max, $prefix = '' ) {
		if ( ! isset( $value[ $key ] ) || ! is_string( $value[ $key ] ) || '' === trim( $value[ $key ] ) ) {
			self::invalid( $prefix . $key, $key . ' must be a non-empty string.' );
		}
		return self::plain_string( $value[ $key ], $max, $prefix . $key );
	}

	private static function plain_string( $value, $max, $path ) {
		if ( ! is_string( $value ) || strlen( $value ) > $max ) {
			self::invalid( $path, 'Value must be a string within the allowed length.' );
		}
		return $value;
	}

	private static function bounded_integer( $value, $min, $max, $path ) {
		if ( ! is_int( $value ) || $value < $min || $value > $max ) {
			self::invalid( $path, 'Value must be an integer in the allowed range.' );
		}
		return $value;
	}

	private static function string_list( $value, $max, $path, $kind, $allow_duplicates = true ) {
		if ( ! is_array( $value ) || ( ! empty( $value ) && self::is_associative( $value ) ) || count( $value ) > $max ) {
			self::invalid( $path, 'Value must be a bounded list.' );
		}
		$output = array();
		foreach ( $value as $index => $item ) {
			$holder = array( 'value' => $item );
			if ( 'slug' === $kind ) {
				$output[] = self::required_slug( $holder, 'value', $path . '[' . $index . '].' );
			} elseif ( 'key' === $kind ) {
				$output[] = self::required_key( $holder, 'value', $path . '[' . $index . '].' );
			} else {
				$output[] = self::plain_string( $item, 100000, $path . '[' . $index . ']' );
			}
		}
		if ( ! $allow_duplicates && count( $output ) !== count( array_unique( $output ) ) ) {
			self::invalid( $path, 'List values must be unique.' );
		}
		return $output;
	}

	private static function assert_object( $value, $path ) {
		if ( ! is_array( $value ) || ! self::is_associative( $value ) ) {
			self::invalid( $path, $path . ' must be a JSON object.' );
		}
	}

	private static function reject_unknown_keys( $value, $allowed, $path ) {
		$unknown = array_diff( array_keys( $value ), $allowed );
		if ( ! empty( $unknown ) ) {
			self::invalid( $path . '.' . reset( $unknown ), 'Unknown contract field.' );
		}
	}

	private static function is_associative( $value ) {
		if ( array() === $value ) {
			return true;
		}
		return array_keys( $value ) !== range( 0, count( $value ) - 1 );
	}

	private static function invalid( $path, $message ) {
		throw new SiteForge_Runtime_Validation_Exception(
			'siteforge_invalid_request',
			$message,
			array( 'path' => $path )
		);
	}
}

