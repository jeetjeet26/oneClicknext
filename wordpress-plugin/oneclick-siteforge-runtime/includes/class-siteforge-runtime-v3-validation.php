<?php
/**
 * Strict, dependency-free validation for the shared SiteForge v3 contract.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_V3_Validation {
	const CONTRACT_VERSION = 3;

	public static function release( $value ) {
		self::object_value( $value, 'release' );
		self::exact_keys( $value, array( 'contractVersion', 'identity', 'resourceGraph', 'operations', 'assetSources', 'target' ), 'release' );
		if ( 3 !== $value['contractVersion'] ) {
			self::invalid( 'release.contractVersion', 'contractVersion must be the integer 3.' );
		}
		$identity   = self::release_identity( $value['identity'], 'release.identity' );
		$graph      = self::resource_graph( $value['resourceGraph'], 'release.resourceGraph' );
		$operations = self::operations( $value['operations'], 'release.operations' );
		$sources    = self::asset_sources( $value['assetSources'], 'release.assetSources' );
		$target     = self::target( $value['target'], 'release.target' );

		self::assert_hash( 'release.identity.resourceGraphHash', $identity['resourceGraphHash'], SiteForge_Runtime_Validation::hash( $graph ) );
		$assets = $graph['assets'];
		usort(
			$assets,
			static function ( $left, $right ) {
				return strcmp( $left['assetId'], $right['assetId'] );
			}
		);
		self::assert_hash( 'release.identity.assetManifestHash', $identity['assetManifestHash'], SiteForge_Runtime_Validation::hash( $assets ) );
		$hash_operations = $operations;
		usort(
			$hash_operations,
			static function ( $left, $right ) {
				return $left['sequence'] <=> $right['sequence'];
			}
		);
		self::assert_hash( 'release.identity.operationSetHash', $identity['operationSetHash'], SiteForge_Runtime_Validation::hash( $hash_operations ) );
		self::assert_asset_sources( $graph['assets'], $sources );
		self::assert_graph_references( $graph );
		self::assert_extension_scopes( $identity['extensions'], $graph );
		self::assert_operation_set( $operations, $graph );

		return array(
			'contractVersion' => 3,
			'identity'        => $identity,
			'resourceGraph'   => $graph,
			'operations'      => $operations,
			'assetSources'    => $sources,
			'target'          => $target,
		);
	}

	public static function asset_request( $value ) {
		self::object_value( $value, 'body' );
		self::exact_keys( $value, array( 'contractVersion', 'identity', 'idempotencyKey', 'assets' ), 'body' );
		if ( 3 !== $value['contractVersion'] ) {
			self::invalid( 'body.contractVersion', 'contractVersion must be the integer 3.' );
		}
		$identity = self::release_identity( $value['identity'], 'body.identity' );
		self::hash_value( $value['idempotencyKey'], 'body.idempotencyKey' );
		self::list_value( $value['assets'], 'body.assets' );
		self::list_bounds( $value['assets'], 0, 2000, 'body.assets' );
		$assets = array();
		foreach ( $value['assets'] as $index => $item ) {
			$path = 'body.assets[' . $index . ']';
			self::exact_keys( $item, array( 'asset', 'source' ), $path );
			$asset  = self::asset( $item['asset'], $path . '.asset' );
			$source = self::asset_source( $item['source'], $path . '.source' );
			if ( $asset['assetId'] !== $source['assetId'] || $asset['byteSha256'] !== $source['byteSha256'] ) {
				self::invalid( $path . '.source', 'Asset source must match the exact immutable asset identity.' );
			}
			$assets[] = array(
				'asset'  => $asset,
				'source' => $source,
			);
		}
		$manifest_assets = array_column( $assets, 'asset' );
		usort(
			$manifest_assets,
			static function ( $left, $right ) {
				return strcmp( $left['assetId'], $right['assetId'] );
			}
		);
		self::assert_hash( 'body.assets', $identity['assetManifestHash'], SiteForge_Runtime_Validation::hash( $manifest_assets ) );
		$expected = self::idempotency_hash( 'asset_preparation', $identity, null );
		self::assert_hash( 'body.idempotencyKey', $value['idempotencyKey'], $expected );
		return array(
			'contractVersion' => 3,
			'identity'        => $identity,
			'idempotencyKey'  => $value['idempotencyKey'],
			'assets'          => $assets,
		);
	}

	public static function deployment_request( $value ) {
		self::object_value( $value, 'body' );
		self::exact_keys( $value, array( 'contractVersion', 'release', 'assetPreparationId', 'expectedRemoteContentHash', 'idempotencyKey' ), 'body' );
		if ( 3 !== $value['contractVersion'] ) {
			self::invalid( 'body.contractVersion', 'contractVersion must be the integer 3.' );
		}
		$release = self::release( $value['release'] );
		self::runtime_id( $value['assetPreparationId'], 'body.assetPreparationId' );
		if ( null !== $value['expectedRemoteContentHash'] ) {
			self::hash_value( $value['expectedRemoteContentHash'], 'body.expectedRemoteContentHash' );
		}
		self::hash_value( $value['idempotencyKey'], 'body.idempotencyKey' );
		self::assert_hash(
			'body.idempotencyKey',
			$value['idempotencyKey'],
			self::idempotency_hash( 'deployment', $release['identity'], $value['expectedRemoteContentHash'] )
		);
		$identity = $release['identity'];
		$resources = $release['resourceGraph'];
		$resources['target'] = $release['target'];
		return array(
			'contractVersion'           => 3,
			'siteId'                    => $identity['siteId'],
			'artifactId'                => $identity['artifactId'],
			'artifactContentHash'       => $identity['artifactContentHash'],
			'expectedRemoteContentHash' => $value['expectedRemoteContentHash'],
			'resourceHash'              => $identity['resourceGraphHash'],
			'assetManifestHash'         => $identity['assetManifestHash'],
			'operationHash'             => $identity['operationSetHash'],
			'packageIdentityHash'       => self::package_identity_hash( $identity ),
			'idempotencyKey'            => $value['idempotencyKey'],
			'assetPreparationId'        => $value['assetPreparationId'],
			'packageIdentities'         => $identity,
			'assets'                    => $release['resourceGraph']['assets'],
			'operations'                => $release['operations'],
			'resources'                 => $resources,
			'release'                   => $release,
		);
	}

	public static function rollback_request( $value ) {
		self::object_value( $value, 'body' );
		self::exact_keys(
			$value,
			array( 'contractVersion', 'transactionId', 'siteId', 'expectedCurrentContentHash', 'restoreArtifactContentHash', 'restoreResourceGraphHash', 'idempotencyKey' ),
			'body'
		);
		if ( 3 !== $value['contractVersion'] ) {
			self::invalid( 'body.contractVersion', 'contractVersion must be the integer 3.' );
		}
		self::uuid( $value['transactionId'], 'body.transactionId' );
		self::runtime_id( $value['siteId'], 'body.siteId' );
		foreach ( array( 'expectedCurrentContentHash', 'restoreArtifactContentHash', 'restoreResourceGraphHash', 'idempotencyKey' ) as $key ) {
			self::hash_value( $value[ $key ], 'body.' . $key );
		}
		$hash_input = $value;
		unset( $hash_input['idempotencyKey'] );
		$hash_input['scope'] = 'rollback';
		$ordered = array(
			'contractVersion'           => 3,
			'scope'                     => 'rollback',
			'transactionId'             => $value['transactionId'],
			'siteId'                    => $value['siteId'],
			'expectedCurrentContentHash'=> $value['expectedCurrentContentHash'],
			'restoreArtifactContentHash'=> $value['restoreArtifactContentHash'],
			'restoreResourceGraphHash'  => $value['restoreResourceGraphHash'],
		);
		self::assert_hash( 'body.idempotencyKey', $value['idempotencyKey'], SiteForge_Runtime_Validation::hash( $ordered ) );
		return $value;
	}

	private static function release_identity( $value, $path ) {
		self::exact_keys(
			$value,
			array( 'siteId', 'artifactId', 'artifactContentHash', 'resourceGraphHash', 'assetManifestHash', 'operationSetHash', 'baseTheme', 'runtimePackage', 'overlays', 'extensions' ),
			$path
		);
		self::runtime_id( $value['siteId'], $path . '.siteId' );
		self::uuid( $value['artifactId'], $path . '.artifactId' );
		foreach ( array( 'artifactContentHash', 'resourceGraphHash', 'assetManifestHash', 'operationSetHash' ) as $key ) {
			self::hash_value( $value[ $key ], $path . '.' . $key );
		}
		$value['baseTheme']     = self::package_identity( $value['baseTheme'], $path . '.baseTheme', 'base_theme' );
		$value['runtimePackage']= self::package_identity( $value['runtimePackage'], $path . '.runtimePackage', 'runtime_plugin' );
		self::list_value( $value['overlays'], $path . '.overlays' );
		self::list_bounds( $value['overlays'], 0, 20, $path . '.overlays' );
		$overlay_ids = array();
		foreach ( $value['overlays'] as $index => &$overlay ) {
			$item_path = $path . '.overlays[' . $index . ']';
			self::exact_keys( $overlay, array( 'overlayId', 'contentHash', 'themeSlug', 'appliesToBaseThemeArchiveSha256', 'package' ), $item_path );
			self::runtime_id( $overlay['overlayId'], $item_path . '.overlayId' );
			self::hash_value( $overlay['contentHash'], $item_path . '.contentHash' );
			if ( 'oneclick-siteforge-overlay-' . substr( $overlay['contentHash'], 0, 12 ) !== $overlay['themeSlug'] ) {
				self::invalid( $item_path . '.themeSlug', 'Overlay child-theme slug must match its exact content identity.' );
			}
			self::hash_value( $overlay['appliesToBaseThemeArchiveSha256'], $item_path . '.appliesToBaseThemeArchiveSha256' );
			if ( $overlay['appliesToBaseThemeArchiveSha256'] !== $value['baseTheme']['archiveSha256'] ) {
				self::invalid( $item_path . '.appliesToBaseThemeArchiveSha256', 'Overlay must bind to the exact base theme archive.' );
			}
			$overlay['package'] = self::package_identity( $overlay['package'], $item_path . '.package', 'theme_overlay' );
			self::unique_id( $overlay_ids, $overlay['overlayId'], $item_path . '.overlayId' );
		}
		unset( $overlay );
		self::list_value( $value['extensions'], $path . '.extensions' );
		self::list_bounds( $value['extensions'], 0, 100, $path . '.extensions' );
		$extension_ids = array();
		foreach ( $value['extensions'] as $index => &$extension ) {
			$item_path = $path . '.extensions[' . $index . ']';
			self::exact_keys( $extension, array( 'extensionId', 'contentHash', 'configurationHash', 'scopes', 'permissions', 'package' ), $item_path );
			self::runtime_id( $extension['extensionId'], $item_path . '.extensionId' );
			self::hash_value( $extension['contentHash'], $item_path . '.contentHash' );
			self::hash_value( $extension['configurationHash'], $item_path . '.configurationHash' );
			self::list_value( $extension['scopes'], $item_path . '.scopes' );
			self::list_bounds( $extension['scopes'], 0, 1000, $item_path . '.scopes' );
			foreach ( $extension['scopes'] as $scope_index => $scope ) {
				self::resource_target( $scope, $item_path . '.scopes[' . $scope_index . ']' );
			}
			self::id_list( $extension['permissions'], $item_path . '.permissions' );
			self::list_bounds( $extension['permissions'], 0, 200, $item_path . '.permissions' );
			$extension['package'] = self::package_identity( $extension['package'], $item_path . '.package', 'extension' );
			self::unique_id( $extension_ids, $extension['extensionId'], $item_path . '.extensionId' );
		}
		unset( $extension );
		$package_ids = array();
		foreach ( array_merge( array( $value['baseTheme'], $value['runtimePackage'] ), array_column( $value['overlays'], 'package' ), array_column( $value['extensions'], 'package' ) ) as $package ) {
			self::unique_id( $package_ids, $package['packageId'], $path . '.packages' );
		}
		return $value;
	}

	private static function package_identity( $value, $path, $expected_type ) {
		self::exact_keys( $value, array( 'packageId', 'packageType', 'archiveSha256', 'archiveBytes', 'manifestSha256', 'manifest' ), $path );
		self::runtime_id( $value['packageId'], $path . '.packageId' );
		if ( $expected_type !== $value['packageType'] ) {
			self::invalid( $path . '.packageType', 'Package type does not match its identity role.' );
		}
		self::hash_value( $value['archiveSha256'], $path . '.archiveSha256' );
		self::positive_integer( $value['archiveBytes'], $path . '.archiveBytes' );
		self::hash_value( $value['manifestSha256'], $path . '.manifestSha256' );
		$value['manifest'] = self::package_manifest( $value['manifest'], $path . '.manifest' );
		self::assert_hash( $path . '.manifestSha256', $value['manifestSha256'], SiteForge_Runtime_Validation::hash( $value['manifest'] ) );
		return $value;
	}

	private static function package_manifest( $value, $path ) {
		self::exact_keys( $value, array( 'schemaVersion', 'contractVersion', 'packageName', 'packageVersion', 'files' ), $path );
		if ( 1 !== $value['schemaVersion'] || 3 !== $value['contractVersion'] ) {
			self::invalid( $path, 'Package manifest versions are invalid.' );
		}
		self::runtime_id( $value['packageName'], $path . '.packageName' );
		if ( ! is_string( $value['packageVersion'] ) || ! preg_match( '/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/', $value['packageVersion'] ) ) {
			self::invalid( $path . '.packageVersion', 'Package version must be semantic.' );
		}
		self::list_value( $value['files'], $path . '.files' );
		self::list_bounds( $value['files'], 1, 10000, $path . '.files' );
		$paths = array();
		foreach ( $value['files'] as $index => $file ) {
			$file_path = $path . '.files[' . $index . ']';
			self::exact_keys( $file, array( 'path', 'byteSha256', 'bytes', 'mode' ), $file_path );
			if ( ! is_string( $file['path'] ) || '' === $file['path'] || 0 === strpos( $file['path'], '/' ) || false !== strpos( $file['path'], '\\' ) || in_array( '..', explode( '/', $file['path'] ), true ) ) {
				self::invalid( $file_path . '.path', 'Manifest path must be package-relative.' );
			}
			self::string_value( $file['path'], $file_path . '.path', 500 );
			self::unique_id( $paths, $file['path'], $file_path . '.path' );
			self::hash_value( $file['byteSha256'], $file_path . '.byteSha256' );
			self::nonnegative_integer( $file['bytes'], $file_path . '.bytes' );
			self::enum_value( $file['mode'], array( 'file', 'executable' ), $file_path . '.mode' );
		}
		return $value;
	}

	private static function resource_graph( $value, $path ) {
		$keys = array( 'graphVersion', 'homepagePageId', 'pages', 'sections', 'globalComponents', 'chrome', 'forms', 'redirects', 'responsiveRules', 'accessibilityAnnotations', 'seo', 'legal', 'analytics', 'integrations', 'assets', 'removals' );
		self::exact_keys( $value, $keys, $path );
		if ( 1 !== $value['graphVersion'] ) {
			self::invalid( $path . '.graphVersion', 'graphVersion must be 1.' );
		}
		self::runtime_id( $value['homepagePageId'], $path . '.homepagePageId' );
		$schemas = array(
			'pages'                    => array( 'resourceId', 'contentHash', 'slug', 'title', 'purpose', 'status', 'template', 'menuOrder', 'sectionIds', 'seoId' ),
			'sections'                 => array( 'resourceId', 'contentHash', 'pageId', 'sectionType', 'blockName', 'order', 'variant', 'anchor', 'cssClasses', 'data', 'assetIds', 'formId', 'integrationIds' ),
			'globalComponents'         => array( 'resourceId', 'contentHash', 'componentType', 'data', 'assetIds', 'integrationIds' ),
			'forms'                    => array( 'resourceId', 'contentHash', 'formType', 'fields', 'submitLabel', 'integrationId', 'consentLegalResourceId', 'successBehavior' ),
			'redirects'                => array( 'resourceId', 'contentHash', 'sourcePath', 'destination', 'statusCode', 'preserveQuery' ),
			'responsiveRules'          => array( 'resourceId', 'contentHash', 'target', 'minWidthPx', 'maxWidthPx', 'declarations' ),
			'accessibilityAnnotations' => array( 'resourceId', 'contentHash', 'target', 'standard', 'role', 'accessibleName', 'description', 'keyboardBehavior', 'headingLevel', 'liveRegion' ),
			'seo'                      => array( 'resourceId', 'contentHash', 'scope', 'pageId', 'title', 'description', 'canonicalPath', 'robots', 'openGraph', 'structuredData' ),
			'legal'                    => array( 'resourceId', 'contentHash', 'policyType', 'policyVersion', 'approvedAt', 'effectiveAt', 'body', 'approvalEvidenceHash' ),
			'integrations'             => array( 'resourceId', 'contentHash', 'provider', 'scopes', 'pageIds', 'formIds', 'allowedDestinations', 'configuration', 'secretReference' ),
			'assets'                   => array( 'resourceId', 'contentHash', 'assetId', 'byteSha256', 'bytes', 'mimeType', 'filename', 'role', 'altText', 'caption', 'width', 'height', 'rights' ),
			'removals'                 => array( 'resourceKind', 'resourceId', 'priorContentHash', 'removedAt', 'reason' ),
		);
		foreach ( $schemas as $collection => $item_keys ) {
			self::list_value( $value[ $collection ], $path . '.' . $collection );
			$bounds = array(
				'pages' => array( 1, 500 ), 'sections' => array( 0, 5000 ), 'globalComponents' => array( 2, 500 ),
				'forms' => array( 0, 500 ), 'redirects' => array( 0, 2000 ), 'responsiveRules' => array( 0, 5000 ),
				'accessibilityAnnotations' => array( 0, 10000 ), 'seo' => array( 1, 1000 ), 'legal' => array( 1, 100 ),
				'integrations' => array( 0, 500 ), 'assets' => array( 0, 2000 ), 'removals' => array( 0, 5000 ),
			);
			self::list_bounds( $value[ $collection ], $bounds[ $collection ][0], $bounds[ $collection ][1], $path . '.' . $collection );
			foreach ( $value[ $collection ] as $index => &$item ) {
				$item_path = $path . '.' . $collection . '[' . $index . ']';
				self::exact_keys( $item, $item_keys, $item_path );
				if ( 'assets' === $collection ) {
					$item = self::asset( $item, $item_path );
				} elseif ( 'removals' === $collection ) {
					self::resource_kind( $item['resourceKind'], $item_path . '.resourceKind' );
					self::runtime_id( $item['resourceId'], $item_path . '.resourceId' );
					self::hash_value( $item['priorContentHash'], $item_path . '.priorContentHash' );
					self::datetime( $item['removedAt'], $item_path . '.removedAt' );
					self::nonempty_string( $item['reason'], $item_path . '.reason', 2000 );
				} else {
					self::resource_identity( $item, $item_path );
					self::validate_resource_fields( $collection, $item, $item_path );
				}
			}
			unset( $item );
		}
		self::exact_keys( $value['chrome'], array( 'resourceId', 'contentHash', 'headerComponentId', 'footerComponentId', 'componentIds' ), $path . '.chrome' );
		self::resource_identity( $value['chrome'], $path . '.chrome' );
		foreach ( array( 'headerComponentId', 'footerComponentId' ) as $key ) {
			self::runtime_id( $value['chrome'][ $key ], $path . '.chrome.' . $key );
		}
		self::id_list( $value['chrome']['componentIds'], $path . '.chrome.componentIds' );
		self::list_bounds( $value['chrome']['componentIds'], 0, 100, $path . '.chrome.componentIds' );
		self::exact_keys( $value['analytics'], array( 'resourceId', 'contentHash', 'consentMode', 'integrationIds', 'events' ), $path . '.analytics' );
		self::resource_identity( $value['analytics'], $path . '.analytics' );
		self::enum_value( $value['analytics']['consentMode'], array( 'required', 'optional', 'disabled' ), $path . '.analytics.consentMode' );
		self::id_list( $value['analytics']['integrationIds'], $path . '.analytics.integrationIds' );
		self::list_bounds( $value['analytics']['integrationIds'], 0, 50, $path . '.analytics.integrationIds' );
		self::list_value( $value['analytics']['events'], $path . '.analytics.events' );
		self::list_bounds( $value['analytics']['events'], 0, 500, $path . '.analytics.events' );
		foreach ( $value['analytics']['events'] as $index => $event ) {
			$event_path = $path . '.analytics.events[' . $index . ']';
			self::exact_keys( $event, array( 'eventId', 'name', 'trigger', 'parameters' ), $event_path );
			self::runtime_id( $event['eventId'], $event_path . '.eventId' );
			self::runtime_id( $event['name'], $event_path . '.name' );
			self::nonempty_string( $event['trigger'], $event_path . '.trigger', 1000 );
			self::object_value( $event['parameters'], $event_path . '.parameters' );
			foreach ( $event['parameters'] as $parameter => $parameter_value ) {
				self::string_value( $parameter_value, $event_path . '.parameters.' . $parameter, 1000 );
			}
		}
		return $value;
	}

	private static function validate_resource_fields( $collection, $item, $path ) {
		switch ( $collection ) {
			case 'pages':
				self::slug( $item['slug'], $path . '.slug' );
				self::nonempty_string( $item['title'], $path . '.title', 500 );
				self::string_value( $item['purpose'], $path . '.purpose', 10000 );
				self::enum_value( $item['status'], array( 'publish', 'draft', 'private' ), $path . '.status' );
				self::string_value( $item['template'], $path . '.template', 255 );
				self::nonnegative_integer( $item['menuOrder'], $path . '.menuOrder' );
				self::id_list( $item['sectionIds'], $path . '.sectionIds' );
				self::list_bounds( $item['sectionIds'], 0, 500, $path . '.sectionIds' );
				self::nullable_id( $item['seoId'], $path . '.seoId' );
				break;
			case 'sections':
				foreach ( array( 'pageId', 'sectionType' ) as $key ) {
					self::runtime_id( $item[ $key ], $path . '.' . $key );
				}
				self::nonempty_string( $item['blockName'], $path . '.blockName', 240 );
				self::nonnegative_integer( $item['order'], $path . '.order' );
				self::nullable_string( $item['variant'], $path . '.variant', 100 );
				self::nullable_id( $item['anchor'], $path . '.anchor' );
				self::id_list( $item['cssClasses'], $path . '.cssClasses' );
				self::list_bounds( $item['cssClasses'], 0, 50, $path . '.cssClasses' );
				self::object_value( $item['data'], $path . '.data' );
				self::uuid_list( $item['assetIds'], $path . '.assetIds' );
				self::list_bounds( $item['assetIds'], 0, 100, $path . '.assetIds' );
				self::nullable_id( $item['formId'], $path . '.formId' );
				self::id_list( $item['integrationIds'], $path . '.integrationIds' );
				self::list_bounds( $item['integrationIds'], 0, 50, $path . '.integrationIds' );
				break;
			case 'globalComponents':
				self::enum_value( $item['componentType'], array( 'header', 'footer', 'navigation', 'announcement', 'modal', 'consent', 'utility' ), $path . '.componentType' );
				self::object_value( $item['data'], $path . '.data' );
				self::uuid_list( $item['assetIds'], $path . '.assetIds' );
				self::list_bounds( $item['assetIds'], 0, 100, $path . '.assetIds' );
				self::id_list( $item['integrationIds'], $path . '.integrationIds' );
				self::list_bounds( $item['integrationIds'], 0, 50, $path . '.integrationIds' );
				break;
			case 'forms':
				self::enum_value( $item['formType'], array( 'contact', 'lead', 'tour', 'application', 'newsletter', 'custom' ), $path . '.formType' );
				self::list_value( $item['fields'], $path . '.fields' );
				self::list_bounds( $item['fields'], 1, 200, $path . '.fields' );
				foreach ( $item['fields'] as $index => $field ) {
					$field_path = $path . '.fields[' . $index . ']';
					self::exact_keys( $field, array( 'fieldId', 'type', 'label', 'required', 'options', 'autocomplete' ), $field_path );
					self::runtime_id( $field['fieldId'], $field_path . '.fieldId' );
					self::enum_value( $field['type'], array( 'text', 'email', 'tel', 'number', 'date', 'time', 'select', 'checkbox', 'radio', 'textarea', 'hidden' ), $field_path . '.type' );
					self::string_value( $field['label'], $field_path . '.label', 500 );
					self::boolean_value( $field['required'], $field_path . '.required' );
					self::string_list( $field['options'], $field_path . '.options' );
					self::list_bounds( $field['options'], 0, 200, $field_path . '.options' );
					foreach ( $field['options'] as $option_index => $option ) {
						self::string_value( $option, $field_path . '.options[' . $option_index . ']', 500 );
					}
					self::nullable_string( $field['autocomplete'], $field_path . '.autocomplete', 100 );
				}
				self::nonempty_string( $item['submitLabel'], $path . '.submitLabel', 200 );
				self::runtime_id( $item['integrationId'], $path . '.integrationId' );
				self::nullable_id( $item['consentLegalResourceId'], $path . '.consentLegalResourceId' );
				self::exact_keys( $item['successBehavior'], array( 'mode', 'message', 'redirectPath' ), $path . '.successBehavior' );
				self::enum_value( $item['successBehavior']['mode'], array( 'message', 'redirect' ), $path . '.successBehavior.mode' );
				self::nullable_string( $item['successBehavior']['message'], $path . '.successBehavior.message', 5000 );
				if ( null !== $item['successBehavior']['redirectPath'] ) {
					self::path_value( $item['successBehavior']['redirectPath'], $path . '.successBehavior.redirectPath' );
				}
				break;
			case 'redirects':
				self::path_value( $item['sourcePath'], $path . '.sourcePath' );
				self::url_or_path( $item['destination'], $path . '.destination' );
				if ( ! in_array( $item['statusCode'], array( 301, 302, 307, 308 ), true ) ) {
					self::invalid( $path . '.statusCode', 'Redirect status is invalid.' );
				}
				self::boolean_value( $item['preserveQuery'], $path . '.preserveQuery' );
				break;
			case 'responsiveRules':
				self::resource_target( $item['target'], $path . '.target' );
				self::nullable_nonnegative_integer( $item['minWidthPx'], $path . '.minWidthPx' );
				self::nullable_positive_integer( $item['maxWidthPx'], $path . '.maxWidthPx' );
				if ( null !== $item['minWidthPx'] && null !== $item['maxWidthPx'] && $item['minWidthPx'] > $item['maxWidthPx'] ) {
					self::invalid( $path, 'Responsive rule minimum width cannot exceed maximum width.' );
				}
				self::object_value( $item['declarations'], $path . '.declarations' );
				foreach ( $item['declarations'] as $declaration => $declaration_value ) {
					self::string_value( $declaration_value, $path . '.declarations.' . $declaration, 2000 );
				}
				break;
			case 'accessibilityAnnotations':
				self::resource_target( $item['target'], $path . '.target' );
				if ( 'WCAG-2.2-AA' !== $item['standard'] ) {
					self::invalid( $path . '.standard', 'Accessibility standard must be WCAG-2.2-AA.' );
				}
				foreach ( array( 'role' => 100, 'accessibleName' => 1000, 'description' => 2000 ) as $key => $max ) {
					self::nullable_string( $item[ $key ], $path . '.' . $key, $max );
				}
				self::string_list( $item['keyboardBehavior'], $path . '.keyboardBehavior' );
				self::list_bounds( $item['keyboardBehavior'], 0, 100, $path . '.keyboardBehavior' );
				foreach ( $item['keyboardBehavior'] as $behavior_index => $behavior ) {
					self::nonempty_string( $behavior, $path . '.keyboardBehavior[' . $behavior_index . ']', 500 );
				}
				if ( null !== $item['headingLevel'] && ( ! is_int( $item['headingLevel'] ) || $item['headingLevel'] < 1 || $item['headingLevel'] > 6 ) ) {
					self::invalid( $path . '.headingLevel', 'Heading level must be 1 through 6 or null.' );
				}
				if ( null !== $item['liveRegion'] ) {
					self::enum_value( $item['liveRegion'], array( 'off', 'polite', 'assertive' ), $path . '.liveRegion' );
				}
				break;
			case 'seo':
				self::enum_value( $item['scope'], array( 'site', 'page' ), $path . '.scope' );
				self::nullable_id( $item['pageId'], $path . '.pageId' );
				if ( ( 'page' === $item['scope'] ) !== ( null !== $item['pageId'] ) ) {
					self::invalid( $path . '.pageId', 'SEO page scope and pageId must agree.' );
				}
				self::nonempty_string( $item['title'], $path . '.title', 500 );
				self::string_value( $item['description'], $path . '.description', 10000 );
				self::path_value( $item['canonicalPath'], $path . '.canonicalPath' );
				self::exact_keys( $item['robots'], array( 'index', 'follow' ), $path . '.robots' );
				self::boolean_value( $item['robots']['index'], $path . '.robots.index' );
				self::boolean_value( $item['robots']['follow'], $path . '.robots.follow' );
				self::exact_keys( $item['openGraph'], array( 'title', 'description', 'imageAssetId' ), $path . '.openGraph' );
				self::string_value( $item['openGraph']['title'], $path . '.openGraph.title', 500 );
				self::string_value( $item['openGraph']['description'], $path . '.openGraph.description', 10000 );
				if ( null !== $item['openGraph']['imageAssetId'] ) {
					self::uuid( $item['openGraph']['imageAssetId'], $path . '.openGraph.imageAssetId' );
				}
				self::list_value( $item['structuredData'], $path . '.structuredData' );
				self::list_bounds( $item['structuredData'], 0, 100, $path . '.structuredData' );
				foreach ( $item['structuredData'] as $structured_index => $structured ) {
					self::object_value( $structured, $path . '.structuredData[' . $structured_index . ']' );
				}
				break;
			case 'legal':
				self::enum_value( $item['policyType'], array( 'privacy', 'terms', 'accessibility', 'fair_housing', 'pricing_disclaimer', 'analytics_consent', 'communications_consent' ), $path . '.policyType' );
				self::positive_integer( $item['policyVersion'], $path . '.policyVersion' );
				self::datetime( $item['approvedAt'], $path . '.approvedAt' );
				self::datetime( $item['effectiveAt'], $path . '.effectiveAt' );
				self::nonempty_string( $item['body'], $path . '.body', 250000 );
				self::hash_value( $item['approvalEvidenceHash'], $path . '.approvalEvidenceHash' );
				break;
			case 'integrations':
				self::runtime_id( $item['provider'], $path . '.provider' );
				self::list_value( $item['scopes'], $path . '.scopes' );
				if ( empty( $item['scopes'] ) ) {
					self::invalid( $path . '.scopes', 'Integration scopes must not be empty.' );
				}
				foreach ( $item['scopes'] as $index => $scope ) {
					self::enum_value( $scope, array( 'site', 'page', 'form_submission', 'analytics', 'public_runtime' ), $path . '.scopes[' . $index . ']' );
				}
				self::id_list( $item['pageIds'], $path . '.pageIds' );
				self::list_bounds( $item['pageIds'], 0, 500, $path . '.pageIds' );
				self::id_list( $item['formIds'], $path . '.formIds' );
				self::list_bounds( $item['formIds'], 0, 500, $path . '.formIds' );
				self::url_list( $item['allowedDestinations'], $path . '.allowedDestinations' );
				self::list_bounds( $item['allowedDestinations'], 0, 100, $path . '.allowedDestinations' );
				self::object_value( $item['configuration'], $path . '.configuration' );
				self::nullable_id( $item['secretReference'], $path . '.secretReference' );
				break;
		}
	}

	private static function asset( $value, $path ) {
		self::exact_keys( $value, array( 'resourceId', 'contentHash', 'assetId', 'byteSha256', 'bytes', 'mimeType', 'filename', 'role', 'altText', 'caption', 'width', 'height', 'rights' ), $path );
		self::resource_identity( $value, $path );
		self::uuid( $value['assetId'], $path . '.assetId' );
		self::hash_value( $value['byteSha256'], $path . '.byteSha256' );
		self::positive_integer( $value['bytes'], $path . '.bytes' );
		self::nonempty_string( $value['mimeType'], $path . '.mimeType', 150 );
		self::nonempty_string( $value['filename'], $path . '.filename', 255 );
		if ( false !== strpos( $value['filename'], '/' ) || false !== strpos( $value['filename'], '\\' ) ) {
			self::invalid( $path . '.filename', 'Asset filename must not contain a path.' );
		}
		self::nonempty_string( $value['role'], $path . '.role', 100 );
		self::nullable_string( $value['altText'], $path . '.altText', 2000 );
		self::nullable_string( $value['caption'], $path . '.caption', 10000 );
		self::nullable_positive_integer( $value['width'], $path . '.width' );
		self::nullable_positive_integer( $value['height'], $path . '.height' );
		self::exact_keys( $value['rights'], array( 'status', 'evidenceHash' ), $path . '.rights' );
		self::enum_value( $value['rights']['status'], array( 'owned', 'licensed', 'generated' ), $path . '.rights.status' );
		self::hash_value( $value['rights']['evidenceHash'], $path . '.rights.evidenceHash' );
		return $value;
	}

	private static function asset_sources( $value, $path ) {
		self::list_value( $value, $path );
		self::list_bounds( $value, 0, 2000, $path );
		$output = array();
		foreach ( $value as $index => $source ) {
			$output[] = self::asset_source( $source, $path . '[' . $index . ']' );
		}
		return $output;
	}

	private static function asset_source( $value, $path ) {
		self::exact_keys( $value, array( 'assetId', 'sourceUrl', 'byteSha256' ), $path );
		self::uuid( $value['assetId'], $path . '.assetId' );
		self::https_url( $value['sourceUrl'], $path . '.sourceUrl' );
		self::hash_value( $value['byteSha256'], $path . '.byteSha256' );
		return $value;
	}

	private static function operations( $value, $path ) {
		self::list_value( $value, $path );
		self::list_bounds( $value, 1, 20000, $path );
		foreach ( $value as $index => $operation ) {
			$item_path = $path . '[' . $index . ']';
			self::exact_keys( $operation, array( 'operationId', 'sequence', 'kind', 'resourceKind', 'resourceId', 'resourceHash', 'payloadHash', 'dependsOn' ), $item_path );
			self::runtime_id( $operation['operationId'], $item_path . '.operationId' );
			self::nonnegative_integer( $operation['sequence'], $item_path . '.sequence' );
			self::enum_value( $operation['kind'], array( 'create', 'update', 'delete', 'bind', 'unbind', 'configure' ), $item_path . '.kind' );
			self::resource_kind( $operation['resourceKind'], $item_path . '.resourceKind' );
			self::runtime_id( $operation['resourceId'], $item_path . '.resourceId' );
			if ( null !== $operation['resourceHash'] ) {
				self::hash_value( $operation['resourceHash'], $item_path . '.resourceHash' );
			}
			if ( ( 'delete' === $operation['kind'] ) !== ( null === $operation['resourceHash'] ) ) {
				self::invalid( $item_path . '.resourceHash', 'Delete operations alone require a null resource hash.' );
			}
			self::hash_value( $operation['payloadHash'], $item_path . '.payloadHash' );
			self::id_list( $operation['dependsOn'], $item_path . '.dependsOn' );
			self::list_bounds( $operation['dependsOn'], 0, 500, $item_path . '.dependsOn' );
		}
		return array_values( $value );
	}

	private static function target( $value, $path ) {
		self::exact_keys( $value, array( 'targetId', 'environment', 'siteUrl', 'protection', 'publicRuntime' ), $path );
		self::runtime_id( $value['targetId'], $path . '.targetId' );
		self::enum_value( $value['environment'], array( 'canonical_preview', 'staging', 'production' ), $path . '.environment' );
		self::https_url( $value['siteUrl'], $path . '.siteUrl' );
		self::exact_keys( $value['protection'], array( 'mode', 'passwordReference' ), $path . '.protection' );
		self::enum_value( $value['protection']['mode'], array( 'noindex', 'password_noindex', 'public' ), $path . '.protection.mode' );
		self::nullable_id( $value['protection']['passwordReference'], $path . '.protection.passwordReference' );
		if ( ( 'password_noindex' === $value['protection']['mode'] ) !== ( null !== $value['protection']['passwordReference'] ) ) {
			self::invalid( $path . '.protection.passwordReference', 'Only password-protected targets carry a password reference.' );
		}
		$runtime = $value['publicRuntime'];
		self::exact_keys( $runtime, array( 'enabled', 'apiBaseUrl', 'websiteId', 'keyReference', 'conversionEndpoint', 'conversionKey', 'telemetryEndpoint', 'allowedOrigins' ), $path . '.publicRuntime' );
		self::boolean_value( $runtime['enabled'], $path . '.publicRuntime.enabled' );
		foreach ( array( 'apiBaseUrl', 'conversionEndpoint', 'telemetryEndpoint' ) as $key ) {
			self::https_url( $runtime[ $key ], $path . '.publicRuntime.' . $key );
		}
		self::uuid( $runtime['websiteId'], $path . '.publicRuntime.websiteId' );
		self::nullable_id( $runtime['keyReference'], $path . '.publicRuntime.keyReference' );
		self::nonempty_string( $runtime['conversionKey'], $path . '.publicRuntime.conversionKey', 512 );
		if ( $runtime['enabled'] && null === $runtime['keyReference'] ) {
			self::invalid( $path . '.publicRuntime.keyReference', 'Enabled public runtime requires a key reference.' );
		}
		self::url_list( $runtime['allowedOrigins'], $path . '.publicRuntime.allowedOrigins' );
		self::list_bounds( $runtime['allowedOrigins'], 0, 100, $path . '.publicRuntime.allowedOrigins' );
		return $value;
	}

	private static function assert_asset_sources( $assets, $sources ) {
		$source_by_id = array();
		foreach ( $sources as $source ) {
			if ( isset( $source_by_id[ $source['assetId'] ] ) ) {
				self::invalid( 'release.assetSources', 'Asset source identities must be unique.' );
			}
			$source_by_id[ $source['assetId'] ] = $source;
		}
		if ( count( $source_by_id ) !== count( $assets ) ) {
			self::invalid( 'release.assetSources', 'Asset sources must exactly match the resource graph asset set.' );
		}
		foreach ( $assets as $asset ) {
			if ( ! isset( $source_by_id[ $asset['assetId'] ] ) || $source_by_id[ $asset['assetId'] ]['byteSha256'] !== $asset['byteSha256'] ) {
				self::invalid( 'release.assetSources', 'Every asset requires one exact byte-matched source.' );
			}
		}
	}

	private static function assert_operation_set( $operations, $graph ) {
		$ids = array();
		foreach ( $operations as $index => $operation ) {
			if ( $operation['sequence'] !== $index ) {
				self::invalid( 'release.operations[' . $index . '].sequence', 'Operation sequences must be contiguous and ordered from zero.' );
			}
			self::unique_id( $ids, $operation['operationId'], 'release.operations[' . $index . '].operationId' );
			$ids[ $operation['operationId'] ] = $index;
		}
		foreach ( $operations as $index => $operation ) {
			foreach ( $operation['dependsOn'] as $dependency ) {
				if ( ! isset( $ids[ $dependency ] ) ) {
					self::invalid( 'release.operations[' . $index . '].dependsOn', 'Operation dependency does not exist.' );
				}
				if ( $ids[ $dependency ] >= $index ) {
					self::invalid( 'release.operations[' . $index . '].dependsOn', 'Operation dependencies must reference an earlier operation.' );
				}
			}
		}
		$resources  = self::graph_resource_map( $graph );
		$tombstones = array();
		foreach ( $graph['removals'] as $removal ) {
			$tombstones[ $removal['resourceKind'] . ':' . $removal['resourceId'] ] = true;
		}
		foreach ( $operations as $index => $operation ) {
			$key = $operation['resourceKind'] . ':' . $operation['resourceId'];
			if ( 'delete' === $operation['kind'] ) {
				if ( ! isset( $tombstones[ $key ] ) ) {
					self::invalid( 'release.operations[' . $index . '].resourceId', 'Delete operation does not reference an exact removal tombstone.' );
				}
			} elseif ( ! isset( $resources[ $operation['resourceId'] ] ) || $resources[ $operation['resourceId'] ]['kind'] !== $operation['resourceKind'] || $resources[ $operation['resourceId'] ]['hash'] !== $operation['resourceHash'] ) {
				self::invalid( 'release.operations[' . $index . '].resourceHash', 'Operation must bind to the exact desired resource identity.' );
			}
		}
	}

	private static function assert_graph_references( $graph ) {
		$resources = self::graph_resource_map( $graph, true );
		if ( ! isset( $resources[ $graph['homepagePageId'] ] ) || 'page' !== $resources[ $graph['homepagePageId'] ]['kind'] ) {
			self::invalid( 'release.resourceGraph.homepagePageId', 'Homepage resource does not exist.' );
		}
		$page_ids        = self::collection_ids( $graph['pages'] );
		$section_ids     = self::collection_ids( $graph['sections'] );
		$component_ids   = self::collection_ids( $graph['globalComponents'] );
		$form_ids        = self::collection_ids( $graph['forms'] );
		$integration_ids = self::collection_ids( $graph['integrations'] );
		$legal_ids       = self::collection_ids( $graph['legal'] );
		$seo_ids         = self::collection_ids( $graph['seo'] );
		$asset_ids       = array();
		foreach ( $graph['assets'] as $asset ) {
			self::unique_id( $asset_ids, $asset['assetId'], 'release.resourceGraph.assets.assetId' );
		}
		foreach ( $graph['pages'] as $index => $page ) {
			self::assert_references( $page['sectionIds'], $section_ids, 'release.resourceGraph.pages[' . $index . '].sectionIds' );
			self::assert_optional_reference( $page['seoId'], $seo_ids, 'release.resourceGraph.pages[' . $index . '].seoId' );
		}
		foreach ( $graph['sections'] as $index => $section ) {
			self::assert_reference( $section['pageId'], $page_ids, 'release.resourceGraph.sections[' . $index . '].pageId' );
			self::assert_optional_reference( $section['formId'], $form_ids, 'release.resourceGraph.sections[' . $index . '].formId' );
			self::assert_references( $section['assetIds'], $asset_ids, 'release.resourceGraph.sections[' . $index . '].assetIds' );
			self::assert_references( $section['integrationIds'], $integration_ids, 'release.resourceGraph.sections[' . $index . '].integrationIds' );
		}
		foreach ( $graph['globalComponents'] as $index => $component ) {
			self::assert_references( $component['assetIds'], $asset_ids, 'release.resourceGraph.globalComponents[' . $index . '].assetIds' );
			self::assert_references( $component['integrationIds'], $integration_ids, 'release.resourceGraph.globalComponents[' . $index . '].integrationIds' );
		}
		self::assert_reference( $graph['chrome']['headerComponentId'], $component_ids, 'release.resourceGraph.chrome.headerComponentId' );
		self::assert_reference( $graph['chrome']['footerComponentId'], $component_ids, 'release.resourceGraph.chrome.footerComponentId' );
		self::assert_references( $graph['chrome']['componentIds'], $component_ids, 'release.resourceGraph.chrome.componentIds' );
		foreach ( $graph['forms'] as $index => $form ) {
			self::assert_reference( $form['integrationId'], $integration_ids, 'release.resourceGraph.forms[' . $index . '].integrationId' );
			self::assert_optional_reference( $form['consentLegalResourceId'], $legal_ids, 'release.resourceGraph.forms[' . $index . '].consentLegalResourceId' );
		}
		self::assert_references( $graph['analytics']['integrationIds'], $integration_ids, 'release.resourceGraph.analytics.integrationIds' );
		foreach ( $graph['seo'] as $index => $seo ) {
			self::assert_optional_reference( $seo['pageId'], $page_ids, 'release.resourceGraph.seo[' . $index . '].pageId' );
			self::assert_optional_reference( $seo['openGraph']['imageAssetId'], $asset_ids, 'release.resourceGraph.seo[' . $index . '].openGraph.imageAssetId' );
		}
		foreach ( $graph['integrations'] as $index => $integration ) {
			self::assert_references( $integration['pageIds'], $page_ids, 'release.resourceGraph.integrations[' . $index . '].pageIds' );
			self::assert_references( $integration['formIds'], $form_ids, 'release.resourceGraph.integrations[' . $index . '].formIds' );
		}
		foreach ( array_merge( $graph['responsiveRules'], $graph['accessibilityAnnotations'] ) as $targeted ) {
			$target = $targeted['target'];
			if ( ! isset( $resources[ $target['resourceId'] ] ) || $resources[ $target['resourceId'] ]['kind'] !== $target['resourceKind'] ) {
				self::invalid( 'release.resourceGraph.resourceTarget', 'Resource target does not exist with the exact kind.' );
			}
		}
		$removals = array();
		foreach ( $graph['removals'] as $index => $removal ) {
			if ( isset( $resources[ $removal['resourceId'] ] ) ) {
				self::invalid( 'release.resourceGraph.removals[' . $index . '].resourceId', 'A desired resource cannot also have a removal tombstone.' );
			}
			self::unique_id( $removals, $removal['resourceKind'] . ':' . $removal['resourceId'], 'release.resourceGraph.removals[' . $index . ']' );
		}
	}

	private static function assert_extension_scopes( $extensions, $graph ) {
		$resources = self::graph_resource_map( $graph );
		foreach ( $extensions as $extension_index => $extension ) {
			foreach ( $extension['scopes'] as $scope_index => $scope ) {
				if ( ! isset( $resources[ $scope['resourceId'] ] ) || $resources[ $scope['resourceId'] ]['kind'] !== $scope['resourceKind'] ) {
					self::invalid( 'release.identity.extensions[' . $extension_index . '].scopes[' . $scope_index . ']', 'Extension scope does not reference an exact resource.' );
				}
			}
		}
	}

	private static function graph_resource_map( $graph, $enforce_unique = false ) {
		$resources = array();
		$kinds = array(
			'pages' => 'page', 'sections' => 'section', 'globalComponents' => 'global_component',
			'forms' => 'form', 'redirects' => 'redirect', 'responsiveRules' => 'responsive_rule',
			'accessibilityAnnotations' => 'accessibility_annotation', 'seo' => 'seo', 'legal' => 'legal',
			'integrations' => 'integration', 'assets' => 'asset',
		);
		foreach ( $kinds as $collection => $kind ) {
			foreach ( $graph[ $collection ] as $index => $resource ) {
				if ( $enforce_unique && isset( $resources[ $resource['resourceId'] ] ) ) {
					self::invalid( 'release.resourceGraph.' . $collection . '[' . $index . '].resourceId', 'Resource IDs must be globally unique.' );
				}
				$resources[ $resource['resourceId'] ] = array( 'kind' => $kind, 'hash' => $resource['contentHash'] );
			}
		}
		foreach ( array( 'chrome' => 'chrome', 'analytics' => 'analytics' ) as $name => $kind ) {
			$resource = $graph[ $name ];
			if ( $enforce_unique && isset( $resources[ $resource['resourceId'] ] ) ) {
				self::invalid( 'release.resourceGraph.' . $name . '.resourceId', 'Resource IDs must be globally unique.' );
			}
			$resources[ $resource['resourceId'] ] = array( 'kind' => $kind, 'hash' => $resource['contentHash'] );
		}
		return $resources;
	}

	private static function collection_ids( $resources ) {
		$ids = array();
		foreach ( $resources as $resource ) {
			$ids[ $resource['resourceId'] ] = true;
		}
		return $ids;
	}

	private static function assert_references( $values, $ids, $path ) {
		foreach ( $values as $value ) {
			self::assert_reference( $value, $ids, $path );
		}
	}

	private static function assert_optional_reference( $value, $ids, $path ) {
		if ( null !== $value ) {
			self::assert_reference( $value, $ids, $path );
		}
	}

	private static function assert_reference( $value, $ids, $path ) {
		if ( ! isset( $ids[ $value ] ) ) {
			self::invalid( $path, 'Resource reference does not exist.' );
		}
	}

	private static function package_identity_hash( $identity ) {
		return SiteForge_Runtime_Validation::hash(
			array(
				'baseTheme'     => $identity['baseTheme'],
				'runtimePackage'=> $identity['runtimePackage'],
				'overlays'      => $identity['overlays'],
				'extensions'    => $identity['extensions'],
			)
		);
	}

	private static function idempotency_hash( $scope, $identity, $expected_hash ) {
		return SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 3,
				'scope'                     => $scope,
				'identity'                  => $identity,
				'expectedRemoteContentHash' => $expected_hash,
			)
		);
	}

	private static function resource_identity( $value, $path ) {
		self::runtime_id( $value['resourceId'], $path . '.resourceId' );
		self::hash_value( $value['contentHash'], $path . '.contentHash' );
	}

	private static function resource_target( $value, $path ) {
		self::exact_keys( $value, array( 'resourceKind', 'resourceId' ), $path );
		self::resource_kind( $value['resourceKind'], $path . '.resourceKind' );
		self::runtime_id( $value['resourceId'], $path . '.resourceId' );
	}

	private static function resource_kind( $value, $path ) {
		self::enum_value( $value, array( 'page', 'section', 'global_component', 'chrome', 'form', 'redirect', 'responsive_rule', 'accessibility_annotation', 'seo', 'legal', 'analytics', 'integration', 'asset' ), $path );
	}

	private static function assert_hash( $path, $expected, $actual ) {
		if ( ! hash_equals( $expected, $actual ) ) {
			throw new SiteForge_Runtime_Validation_Exception(
				'siteforge_v3_identity_hash_mismatch',
				$path . ' does not match its canonical payload.',
				array(
					'path'     => $path,
					'expected' => $expected,
					'actual'   => $actual,
				)
			);
		}
	}

	private static function exact_keys( $value, $keys, $path ) {
		self::object_value( $value, $path );
		$unknown = array_diff( array_keys( $value ), $keys );
		if ( ! empty( $unknown ) ) {
			self::invalid( $path . '.' . reset( $unknown ), 'Unknown contract field.' );
		}
		foreach ( $keys as $key ) {
			if ( ! array_key_exists( $key, $value ) ) {
				self::invalid( $path . '.' . $key, $key . ' is required.' );
			}
		}
	}

	private static function object_value( $value, $path ) {
		if ( ! is_array( $value ) || ( ! empty( $value ) && array_keys( $value ) === range( 0, count( $value ) - 1 ) ) ) {
			self::invalid( $path, 'Value must be a JSON object.' );
		}
	}

	private static function list_value( $value, $path ) {
		if ( ! is_array( $value ) || ( ! empty( $value ) && array_keys( $value ) !== range( 0, count( $value ) - 1 ) ) ) {
			self::invalid( $path, 'Value must be a JSON list.' );
		}
	}

	private static function list_bounds( $value, $minimum, $maximum, $path ) {
		$count = count( $value );
		if ( $count < $minimum || $count > $maximum ) {
			self::invalid( $path, 'List length is outside the contract bounds.' );
		}
	}

	private static function runtime_id( $value, $path ) {
		if ( ! is_string( $value ) || ! preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/', $value ) ) {
			self::invalid( $path, 'Value must be a runtime ID.' );
		}
	}

	private static function nullable_id( $value, $path ) {
		if ( null !== $value ) {
			self::runtime_id( $value, $path );
		}
	}

	private static function id_list( $value, $path ) {
		self::list_value( $value, $path );
		foreach ( $value as $index => $item ) {
			self::runtime_id( $item, $path . '[' . $index . ']' );
		}
	}

	private static function uuid_list( $value, $path ) {
		self::list_value( $value, $path );
		foreach ( $value as $index => $item ) {
			self::uuid( $item, $path . '[' . $index . ']' );
		}
	}

	private static function string_list( $value, $path ) {
		self::list_value( $value, $path );
		foreach ( $value as $index => $item ) {
			self::string_value( $item, $path . '[' . $index . ']', 100000 );
		}
	}

	private static function url_list( $value, $path ) {
		self::list_value( $value, $path );
		foreach ( $value as $index => $item ) {
			self::https_url( $item, $path . '[' . $index . ']' );
		}
	}

	private static function uuid( $value, $path ) {
		if ( ! is_string( $value ) || ! preg_match( SiteForge_Runtime_Validation::UUID_PATTERN, $value ) ) {
			self::invalid( $path, 'Value must be a UUID.' );
		}
	}

	private static function hash_value( $value, $path ) {
		if ( ! SiteForge_Runtime_Validation::is_hash( $value ) ) {
			self::invalid( $path, 'Value must be a lowercase SHA-256 hash.' );
		}
	}

	private static function slug( $value, $path ) {
		if ( ! is_string( $value ) || ! preg_match( '/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $value ) ) {
			self::invalid( $path, 'Value must be a normalized slug.' );
		}
	}

	private static function string_value( $value, $path, $max ) {
		if ( ! is_string( $value ) || strlen( $value ) > $max ) {
			self::invalid( $path, 'Value must be a bounded string.' );
		}
	}

	private static function nonempty_string( $value, $path, $max ) {
		self::string_value( $value, $path, $max );
		if ( '' === trim( $value ) ) {
			self::invalid( $path, 'Value must be non-empty.' );
		}
	}

	private static function nullable_string( $value, $path, $max ) {
		if ( null !== $value ) {
			self::string_value( $value, $path, $max );
		}
	}

	private static function positive_integer( $value, $path ) {
		if ( ! is_int( $value ) || $value < 1 ) {
			self::invalid( $path, 'Value must be a positive integer.' );
		}
	}

	private static function nullable_positive_integer( $value, $path ) {
		if ( null !== $value ) {
			self::positive_integer( $value, $path );
		}
	}

	private static function nonnegative_integer( $value, $path ) {
		if ( ! is_int( $value ) || $value < 0 ) {
			self::invalid( $path, 'Value must be a nonnegative integer.' );
		}
	}

	private static function nullable_nonnegative_integer( $value, $path ) {
		if ( null !== $value ) {
			self::nonnegative_integer( $value, $path );
		}
	}

	private static function boolean_value( $value, $path ) {
		if ( ! is_bool( $value ) ) {
			self::invalid( $path, 'Value must be boolean.' );
		}
	}

	private static function enum_value( $value, $allowed, $path ) {
		if ( ! is_string( $value ) || ! in_array( $value, $allowed, true ) ) {
			self::invalid( $path, 'Value is not an allowed enum member.' );
		}
	}

	private static function path_value( $value, $path ) {
		if ( ! is_string( $value ) || ! preg_match( '#^/(?:[A-Za-z0-9._~!$&\'()*+,;=:@%\-]+/?)*$#', $value ) ) {
			self::invalid( $path, 'Value must be a root-relative path.' );
		}
	}

	private static function https_url( $value, $path ) {
		if ( ! is_string( $value ) || false === filter_var( $value, FILTER_VALIDATE_URL ) || 'https' !== strtolower( (string) parse_url( $value, PHP_URL_SCHEME ) ) ) {
			self::invalid( $path, 'Value must be an HTTPS URL.' );
		}
	}

	private static function url_or_path( $value, $path ) {
		if ( is_string( $value ) && 0 === strpos( $value, '/' ) ) {
			self::path_value( $value, $path );
			return;
		}
		self::https_url( $value, $path );
	}

	private static function datetime( $value, $path ) {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $value ) || false === strtotime( $value ) ) {
			self::invalid( $path, 'Value must be an ISO-8601 datetime.' );
		}
	}

	private static function unique_id( &$seen, $id, $path ) {
		if ( isset( $seen[ $id ] ) ) {
			self::invalid( $path, 'Identity must be unique.' );
		}
		$seen[ $id ] = true;
	}

	private static function invalid( $path, $message ) {
		throw new SiteForge_Runtime_Validation_Exception(
			'siteforge_v3_invalid_request',
			$message,
			array( 'path' => $path )
		);
	}
}
