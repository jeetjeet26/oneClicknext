<?php
/**
 * Materialize a validated SiteForge v3 resource graph into WordPress.
 *
 * @package OneClick_SiteForge_Runtime
 */

class SiteForge_Runtime_V3_Materializer {
	const PAGE_RESOURCE_META = '_siteforge_v3_resource_id';
	const PAGE_SITE_META     = '_siteforge_v3_site_id';
	const PAGE_ARTIFACT_META = '_siteforge_v3_artifact_id';
	const PAGE_HASH_META     = '_siteforge_v3_content_hash';
	const MENU_ITEM_META     = '_siteforge_v3_navigation_item_id';
	const MENU_RESOURCE_META = '_siteforge_v3_navigation_resource_id';

	const RESOURCE_IDS_OPTION = 'oneclick_siteforge_runtime_resource_ids_v3';
	const MENU_OWNERS_OPTION  = 'oneclick_siteforge_runtime_menu_owners_v3';
	const FORMS_OPTION        = 'oneclick_siteforge_forms_v3';
	const REDIRECTS_OPTION    = 'oneclick_siteforge_redirects_v3';
	const INTEGRATIONS_OPTION = 'oneclick_siteforge_integrations_v3';
	const LEGAL_OPTION        = 'oneclick_siteforge_legal_v3';
	const SEO_OPTION          = 'oneclick_siteforge_seo_v3';
	const PENDING_THEME_OPTION = 'oneclick_siteforge_runtime_pending_theme_v3';

	/** @var SiteForge_Runtime_V3_Assets */
	private $assets;

	public function __construct( SiteForge_Runtime_V3_Assets $assets ) {
		$this->assets = $assets;
	}

	/**
	 * Capture every WordPress object this materializer is allowed to mutate.
	 */
	public function snapshot( $site_id ) {
		$pages = array();
		foreach ( $this->owned_page_ids( $site_id ) as $page_id ) {
			$post = get_post( $page_id, ARRAY_A );
			if ( is_array( $post ) ) {
				$pages[ $page_id ] = array(
					'post' => $post,
					'meta' => get_post_meta( $page_id ),
				);
			}
		}

		$options = array();
		foreach ( $this->managed_options() as $option ) {
			$sentinel = '__siteforge_v3_materializer_missing_' . $this->uuid();
			$value    = get_option( $option, $sentinel );
			$options[ $option ] = array(
				'exists' => $sentinel !== $value,
				'value'  => $sentinel !== $value ? $value : null,
			);
		}

		$active_theme = get_option( self::PENDING_THEME_OPTION, null );
		if ( ! is_array( $active_theme ) || empty( $active_theme['stylesheet'] ) || empty( $active_theme['template'] ) ) {
			$active_theme = array(
				'stylesheet' => get_stylesheet(),
				'template'   => get_template(),
			);
		}
		delete_option( self::PENDING_THEME_OPTION );

		return array(
			'siteId'           => $site_id,
			'pages'            => $pages,
			'ownedPageIds'     => array_values( array_map( 'absint', array_keys( $pages ) ) ),
			'options'          => $options,
			'navMenuLocations' => get_theme_mod( 'nav_menu_locations', array() ),
			'menus'            => $this->snapshot_owned_menus( $site_id ),
			'activeTheme'      => $active_theme,
		);
	}

	/**
	 * Apply the complete graph to concrete WordPress resources.
	 */
	public function apply( $input ) {
		$graph       = $input['release']['resourceGraph'];
		$site_id     = $input['siteId'];
		$artifact_id = $input['artifactId'];
		$bindings    = $this->asset_bindings( $input['assetPreparationId'] );
		$environment = isset( $input['release']['target']['environment'] ) ? (string) $input['release']['target']['environment'] : '';
		$allow_legacy_adoption = in_array( $environment, array( 'canonical_preview', 'staging' ), true );

		$this->assert_inventory_fresh( $graph['sections'] );
		$this->assert_page_ownership( $graph, $site_id, $allow_legacy_adoption );

		$sections = array();
		foreach ( $graph['sections'] as $section ) {
			$sections[ $section['resourceId'] ] = $section;
		}
		$forms = array();
		foreach ( $graph['forms'] as $form ) {
			$forms[ $form['resourceId'] ] = $form;
		}
		$integrations = array();
		foreach ( $graph['integrations'] as $integration ) {
			$integrations[ $integration['resourceId'] ] = $integration;
		}
		$seo = array();
		foreach ( $graph['seo'] as $entry ) {
			$seo[ $entry['resourceId'] ] = $entry;
		}
		$presentation = $this->presentation_maps( $graph );

		$page_ids = array();
		foreach ( $graph['pages'] as $page ) {
			$page_ids[ $page['resourceId'] ] = $this->apply_page(
				$page,
				$sections,
				$forms,
				$integrations,
				$seo,
				$bindings,
				$site_id,
				$artifact_id,
				$presentation,
				$allow_legacy_adoption
			);
		}
		ksort( $page_ids, SORT_STRING );
		$this->apply_page_removals( $graph, $site_id );

		$menu_ids = $this->apply_chrome( $graph, $page_ids, $site_id );
		$this->apply_options( $graph, $input['release']['target'], $bindings );

		$front_page_id = isset( $page_ids[ $graph['homepagePageId'] ] ) ? $page_ids[ $graph['homepagePageId'] ] : 0;
		if ( ! $front_page_id ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_homepage_missing', 'The v3 homepage did not materialize.', 500 );
		}
		$this->persist_option( 'show_on_front', 'page', 'homepage mode' );
		$this->persist_option( 'page_on_front', absint( $front_page_id ), 'homepage ID' );

		$resource_ids = $this->allocate_resource_ids( $graph, $page_ids, $menu_ids, $bindings, $site_id );
		$spec         = $this->verification_spec( $graph, $input['release']['identity'], $input['release']['target'], $page_ids, $menu_ids, $resource_ids, $bindings, $site_id, $artifact_id );
		$verification = $this->verify( $spec );
		if ( ! $verification['verified'] ) {
			throw new SiteForge_Runtime_Exception(
				'siteforge_v3_materialization_readback_failed',
				'Materialized WordPress resources do not match the v3 graph.',
				500,
				array( 'checks' => $verification['checks'] )
			);
		}

		return array(
			'resourceIds'     => $resource_ids,
			'pageIds'         => $page_ids,
			'menuIds'         => $menu_ids,
			'verificationSpec'=> $spec,
			'verification'    => $verification,
		);
	}

	public function restore( $snapshot ) {
		if ( ! is_array( $snapshot ) || ! isset( $snapshot['siteId'], $snapshot['pages'], $snapshot['options'] ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_snapshot_invalid', 'The materializer rollback snapshot is invalid.', 500 );
		}

		$expected_ids = array_values( array_map( 'absint', array_keys( $snapshot['pages'] ) ) );
		foreach ( $this->owned_page_ids( $snapshot['siteId'] ) as $page_id ) {
			if ( ! in_array( absint( $page_id ), $expected_ids, true ) ) {
				wp_delete_post( $page_id, true );
			}
		}
		foreach ( $snapshot['pages'] as $page_id => $saved ) {
			if ( 'trash' !== $saved['post']['post_status'] && 'trash' === get_post_status( $page_id ) ) {
				wp_untrash_post( $page_id );
			}
			$result = wp_update_post( wp_slash( $saved['post'] ), true );
			if ( is_wp_error( $result ) || ! $result ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_failed', 'Could not restore a v3-owned page.', 500, array( 'pageId' => absint( $page_id ) ) );
			}
			$this->restore_post_meta( $page_id, $saved['meta'] );
		}
		$restored_menus = $this->restore_owned_menus( $snapshot['siteId'], $snapshot['menus'] );
		foreach ( $snapshot['options'] as $option => $saved ) {
			if ( ! in_array( $option, $this->managed_options(), true ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_snapshot_invalid', 'Snapshot contains an unmanaged option.', 500 );
			}
			if ( $saved['exists'] ) {
				$this->persist_option( $option, $saved['value'], 'rollback option' );
			} else {
				delete_option( $option );
			}
		}
		$locations = $snapshot['navMenuLocations'];
		$owners    = get_option( self::MENU_OWNERS_OPTION, array() );
		$owners    = is_array( $owners ) ? $owners : array();
		foreach ( $restored_menus as $resource_id => $owner ) {
			$locations[ $owner['location'] ] = $owner['menuId'];
			$owners[ $resource_id ] = $owner;
		}
		if ( ! empty( $restored_menus ) ) {
			$this->persist_option( self::MENU_OWNERS_OPTION, $owners, 'restored menu ownership' );
			$resource_record = get_option( self::RESOURCE_IDS_OPTION, array() );
			if ( is_array( $resource_record ) && isset( $resource_record['ids'] ) && is_array( $resource_record['ids'] ) ) {
				foreach ( $restored_menus as $resource_id => $owner ) {
					$resource_record['ids'][ $resource_id ] = $owner['menuId'];
				}
				$this->persist_option( self::RESOURCE_IDS_OPTION, $resource_record, 'restored menu resource IDs' );
			}
			$this->repair_active_spec_after_menu_restore( $restored_menus );
		}
		set_theme_mod( 'nav_menu_locations', $locations );
		if ( ! isset( $snapshot['activeTheme']['stylesheet'], $snapshot['activeTheme']['template'] ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_snapshot_invalid', 'Snapshot is missing the prior active theme.', 500 );
		}
		switch_theme( $snapshot['activeTheme']['stylesheet'] );
		$this->assert_snapshot( $snapshot, $restored_menus );
	}

	public function verify( $spec ) {
		$checks = array();
		foreach ( $spec['pages'] as $resource_id => $expected ) {
			clean_post_cache( $expected['id'] );
			wp_cache_delete( $expected['id'], 'post_meta' );
			$post = get_post( $expected['id'] );
			$actual = $post ? array(
				'resourceId' => (string) get_post_meta( $post->ID, self::PAGE_RESOURCE_META, true ),
				'siteId'     => (string) get_post_meta( $post->ID, self::PAGE_SITE_META, true ),
				'artifactId' => (string) get_post_meta( $post->ID, self::PAGE_ARTIFACT_META, true ),
				'hash'       => (string) get_post_meta( $post->ID, self::PAGE_HASH_META, true ),
				'slug'       => $post->post_name,
				'title'      => $post->post_title,
				'content'    => $post->post_content,
				'status'     => $post->post_status,
				'menuOrder'  => (int) $post->menu_order,
				'template'   => (string) get_page_template_slug( $post->ID ),
				'seo'        => $this->seo_readback( $post->ID ),
			) : null;
			$actual_hash = null !== $actual ? SiteForge_Runtime_Validation::hash( $actual ) : null;
			$passed = null !== $actual_hash && hash_equals( $expected['readbackHash'], $actual_hash );
			$checks[] = $this->check(
				'wordpress_page:' . $resource_id,
				$passed,
				$passed
					? 'Page matches.'
					: sprintf(
						'Page readback mismatch (expected %s, actual %s, artifact %s).',
						$expected['readbackHash'],
						null === $actual_hash ? 'missing' : $actual_hash,
						null === $actual ? 'missing' : $actual['artifactId']
					)
			);
		}
		foreach ( $spec['removedPages'] as $resource_id ) {
			$page_id  = $this->find_owned_page( $resource_id, $spec['siteId'] );
			$passed   = 0 === $page_id || 'trash' === get_post_status( $page_id );
			$checks[] = $this->check( 'wordpress_page_removed:' . $resource_id, $passed, $passed ? 'Owned page removed.' : 'Owned page remains.' );
		}
		foreach ( $spec['optionHashes'] as $option => $hash ) {
			wp_cache_delete( $option, 'options' );
			wp_cache_delete( 'alloptions', 'options' );
			wp_cache_delete( 'notoptions', 'options' );
			$actual   = SiteForge_Runtime_Validation::hash( get_option( $option, null ) );
			$passed   = hash_equals( $hash, $actual );
			$checks[] = $this->check(
				'wordpress_option:' . $option,
				$passed,
				$passed
					? 'Option matches.'
					: sprintf( 'Option readback mismatch (expected %s, actual %s).', $hash, $actual )
			);
		}
		$front_ok = 'page' === get_option( 'show_on_front' ) && absint( get_option( 'page_on_front' ) ) === absint( $spec['homepageId'] );
		$checks[] = $this->check( 'wordpress_homepage', $front_ok, $front_ok ? 'Homepage matches.' : 'Homepage mismatch.' );
		foreach ( $spec['menus'] as $resource_id => $menu ) {
			$actual_hash = $this->menu_readback_hash( $menu['menuId'] );
			$passed      = null !== $actual_hash && hash_equals( $menu['hash'], $actual_hash );
			$checks[]    = $this->check( 'wordpress_menu:' . $resource_id, $passed, $passed ? 'Menu matches.' : 'Menu readback mismatch.' );
		}
		$id_ok = SiteForge_Runtime_Validation::hash( get_option( self::RESOURCE_IDS_OPTION, array() ) ) === $spec['resourceIdsHash'];
		$checks[] = $this->check( 'wordpress_resource_ids', $id_ok, $id_ok ? 'Resource IDs match.' : 'Resource ID mapping mismatch.' );
		$theme = $this->theme_readback();
		$stylesheet_ok = $spec['theme']['stylesheet'] === $theme['stylesheet'];
		$template_ok   = $spec['theme']['template'] === $theme['template'];
		$css_ok        = ! $spec['theme']['requiresOverlayCss'] || $theme['overlayCssLoaded'];
		$checks[] = $this->check( 'wordpress_theme_stylesheet', $stylesheet_ok, $stylesheet_ok ? 'Active stylesheet matches.' : 'Active stylesheet mismatch.' );
		$checks[] = $this->check( 'wordpress_theme_template', $template_ok, $template_ok ? 'Active template matches.' : 'Active template mismatch.' );
		$checks[] = $this->check( 'wordpress_theme_overlay_css', $css_ok, $css_ok ? 'Overlay CSS is loaded.' : 'Overlay CSS is not loaded.' );

		$verified = true;
		foreach ( $checks as $check ) {
			if ( ! $check['passed'] ) {
				$verified = false;
				break;
			}
		}
		return array(
			'verified'   => $verified,
			'checks'     => $checks,
			'verifiedAt' => gmdate( 'c' ),
		);
	}

	private function apply_page( $page, $sections, $forms, $integrations, $seo, $bindings, $site_id, $artifact_id, $presentation, $allow_legacy_adoption = false ) {
		$page_id = $this->find_owned_page( $page['resourceId'], $site_id );
		if ( ! $page_id ) {
			$existing = get_page_by_path( $page['slug'], OBJECT, 'page' );
			if ( $existing ) {
				$owner = (string) get_post_meta( $existing->ID, self::PAGE_SITE_META, true );
				if ( $site_id !== $owner && ! ( '' === $owner && $allow_legacy_adoption && $this->is_legacy_siteforge_page( $existing->ID ) ) ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_page_slug_conflict', 'A v3 page slug belongs to an unowned page.', 409, array( 'slug' => $page['slug'], 'pageId' => absint( $existing->ID ) ) );
				}
				$page_id = absint( $existing->ID );
			}
		}
		$page_sections = array();
		foreach ( $page['sectionIds'] as $section_id ) {
			$page_sections[] = $sections[ $section_id ];
		}
		usort(
			$page_sections,
			static function ( $left, $right ) {
				return $left['order'] <=> $right['order'];
			}
		);
		$content = $this->render_sections( $page_sections, $forms, $integrations, $bindings, $presentation );
		$postarr = array(
			'post_type'    => 'page',
			'post_title'   => wp_slash( $page['title'] ),
			'post_name'    => $page['slug'],
			'post_content' => wp_slash( $content ),
			'post_excerpt' => wp_slash( $page['purpose'] ),
			'post_status'  => $page['status'],
			'menu_order'   => $page['menuOrder'],
			'page_template'=> $page['template'],
		);
		if ( $page_id ) {
			$postarr['ID'] = $page_id;
		}
		$result = wp_insert_post( $postarr, true );
		if ( is_wp_error( $result ) || ! $result ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_page_apply_failed', 'Could not materialize v3 page ' . $page['resourceId'] . '.', 500 );
		}
		$page_id = absint( $result );
		update_post_meta( $page_id, self::PAGE_RESOURCE_META, $page['resourceId'] );
		update_post_meta( $page_id, self::PAGE_SITE_META, $site_id );
		update_post_meta( $page_id, self::PAGE_ARTIFACT_META, $artifact_id );
		update_post_meta( $page_id, self::PAGE_HASH_META, $page['contentHash'] );
		update_post_meta( $page_id, '_siteforge_page_key', $page['resourceId'] );
		update_post_meta( $page_id, '_siteforge_artifact_id', $artifact_id );
		update_post_meta( $page_id, '_siteforge_page_content_hash', $page['contentHash'] );
		update_post_meta( $page_id, '_siteforge_page_purpose', $page['purpose'] );
		$this->apply_seo( $page_id, null !== $page['seoId'] ? $seo[ $page['seoId'] ] : null, $bindings );
		clean_post_cache( $page_id );
		wp_cache_delete( $page_id, 'post_meta' );
		return $page_id;
	}

	private function render_sections( $sections, $forms, $integrations, $bindings, $presentation = array() ) {
		$output = array();
		foreach ( $sections as $section ) {
			if ( 0 !== strpos( $section['blockName'], 'acf/' ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_block_unsupported', 'V3 sections may only materialize registered ACF blocks.', 422, array( 'block' => $section['blockName'] ) );
			}
			if ( class_exists( 'WP_Block_Type_Registry' ) && ! WP_Block_Type_Registry::get_instance()->is_registered( $section['blockName'] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_block_unsupported', 'The active theme does not register ' . $section['blockName'] . '.', 422 );
			}
			$data = $this->bind_assets( $section['data'], $bindings );
			$data['_siteforge_section_id'] = $section['resourceId'];
			if ( null !== $section['formId'] ) {
				$form = $forms[ $section['formId'] ];
				$data['_siteforge_form'] = $form;
				$data['_siteforge_integration'] = $integrations[ $form['integrationId'] ];
			}
			$attrs = array(
				'id'                 => 'block_' . preg_replace( '/[^A-Za-z0-9_-]/', '_', $section['resourceId'] ),
				'name'               => $section['blockName'],
				'data'               => $data,
				'mode'               => 'preview',
				'siteforgeSectionId' => $section['resourceId'],
			);
			if ( null !== $section['anchor'] ) {
				$attrs['anchor'] = $section['anchor'];
			}
			if ( ! empty( $section['cssClasses'] ) ) {
				$attrs['className'] = implode( ' ', $section['cssClasses'] );
			}
			$attrs['className'] = trim( ( isset( $attrs['className'] ) ? $attrs['className'] . ' ' : '' ) . 'siteforge-resource-' . sanitize_html_class( $section['resourceId'] ) );
			if ( isset( $presentation['accessibility'][ $section['resourceId'] ] ) ) {
				$attrs['siteforgeA11y'] = $presentation['accessibility'][ $section['resourceId'] ];
			}
			if ( null !== $section['variant'] ) {
				$attrs['data']['variant'] = $section['variant'];
			}
			$json = wp_json_encode( $attrs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
			$output[] = '<!-- wp:' . $section['blockName'] . ' ' . str_replace( '--', '\u002d\u002d', $json ) . ' /-->';
		}
		return implode( "\n\n", $output );
	}

	private function apply_seo( $page_id, $seo, $bindings ) {
		$keys = array(
			'_siteforge_seo_declared', '_siteforge_seo_title', '_siteforge_seo_description',
			'_siteforge_seo_canonical_path', '_siteforge_seo_noindex', '_siteforge_seo_nofollow',
			'_siteforge_seo_json_ld', '_siteforge_seo_og_title', '_siteforge_seo_og_description',
			'_siteforge_seo_og_image',
		);
		if ( null === $seo ) {
			foreach ( $keys as $key ) {
				delete_post_meta( $page_id, $key );
			}
			return;
		}
		$image_url = '';
		$asset_id  = $seo['openGraph']['imageAssetId'];
		if ( null !== $asset_id && isset( $bindings[ $asset_id ] ) ) {
			$image_url = $bindings[ $asset_id ]['url'];
		}
		update_post_meta( $page_id, '_siteforge_seo_declared', '1' );
		update_post_meta( $page_id, '_siteforge_seo_title', $seo['title'] );
		update_post_meta( $page_id, '_siteforge_seo_description', $seo['description'] );
		update_post_meta( $page_id, '_siteforge_seo_canonical_path', $seo['canonicalPath'] );
		update_post_meta( $page_id, '_siteforge_seo_noindex', $seo['robots']['index'] ? '0' : '1' );
		update_post_meta( $page_id, '_siteforge_seo_nofollow', $seo['robots']['follow'] ? '0' : '1' );
		update_post_meta( $page_id, '_siteforge_seo_json_ld', $seo['structuredData'] );
		update_post_meta( $page_id, '_siteforge_seo_og_title', $seo['openGraph']['title'] );
		update_post_meta( $page_id, '_siteforge_seo_og_description', $seo['openGraph']['description'] );
		update_post_meta( $page_id, '_siteforge_seo_og_image', $image_url );
	}

	private function seo_spec( $seo, $bindings ) {
		$image_url = '';
		if ( null !== $seo['openGraph']['imageAssetId'] && isset( $bindings[ $seo['openGraph']['imageAssetId'] ] ) ) {
			$image_url = $bindings[ $seo['openGraph']['imageAssetId'] ]['url'];
		}
		return array(
			'title'       => $seo['title'],
			'description' => $seo['description'],
			'canonical'   => $seo['canonicalPath'],
			'noindex'     => ! $seo['robots']['index'],
			'nofollow'    => ! $seo['robots']['follow'],
			'structured'  => $seo['structuredData'],
			'ogTitle'     => $seo['openGraph']['title'],
			'ogDescription'=> $seo['openGraph']['description'],
			'ogImage'     => $image_url,
		);
	}

	private function seo_readback( $page_id ) {
		if ( '1' !== (string) get_post_meta( $page_id, '_siteforge_seo_declared', true ) ) {
			return null;
		}
		return array(
			'title'       => (string) get_post_meta( $page_id, '_siteforge_seo_title', true ),
			'description' => (string) get_post_meta( $page_id, '_siteforge_seo_description', true ),
			'canonical'   => (string) get_post_meta( $page_id, '_siteforge_seo_canonical_path', true ),
			'noindex'     => '1' === (string) get_post_meta( $page_id, '_siteforge_seo_noindex', true ),
			'nofollow'    => '1' === (string) get_post_meta( $page_id, '_siteforge_seo_nofollow', true ),
			'structured'  => (array) get_post_meta( $page_id, '_siteforge_seo_json_ld', true ),
			'ogTitle'     => (string) get_post_meta( $page_id, '_siteforge_seo_og_title', true ),
			'ogDescription'=> (string) get_post_meta( $page_id, '_siteforge_seo_og_description', true ),
			'ogImage'     => (string) get_post_meta( $page_id, '_siteforge_seo_og_image', true ),
		);
	}

	private function apply_page_removals( $graph, $site_id ) {
		foreach ( $graph['removals'] as $removal ) {
			if ( 'page' !== $removal['resourceKind'] ) {
				continue;
			}
			$page_id = $this->find_owned_page( $removal['resourceId'], $site_id );
			if ( ! $page_id ) {
				continue;
			}
			$current_hash = (string) get_post_meta( $page_id, self::PAGE_HASH_META, true );
			if ( ! hash_equals( $removal['priorContentHash'], $current_hash ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_removal_ownership_conflict', 'Removal tombstone does not match the owned page identity.', 409, array( 'resourceId' => $removal['resourceId'] ) );
			}
			if ( ! wp_trash_post( $page_id ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_page_removal_failed', 'Could not remove a v3-owned page.', 500 );
			}
		}
	}

	private function apply_options( $graph, $target, $bindings ) {
		$components = array();
		foreach ( $graph['globalComponents'] as $component ) {
			$components[ $component['resourceId'] ] = $this->bind_assets( $component, $bindings );
		}
		$logo_attachment_id = 0;
		foreach ( $graph['assets'] as $asset ) {
			if ( false !== strpos( strtolower( $asset['role'] ), 'logo' ) && isset( $bindings[ $asset['assetId'] ] ) ) {
				$logo_attachment_id = absint( $bindings[ $asset['assetId'] ]['attachmentId'] );
				break;
			}
		}
		if ( $logo_attachment_id ) {
			set_theme_mod( 'custom_logo', $logo_attachment_id );
		} else {
			remove_theme_mod( 'custom_logo' );
		}
		$header = $components[ $graph['chrome']['headerComponentId'] ]['data'];
		$footer = $components[ $graph['chrome']['footerComponentId'] ]['data'];
		$configuration_component = isset( $components['component:site-configuration'] )
			? $components['component:site-configuration']['data']
			: null;
		if ( null !== $configuration_component ) {
			$required_configuration = array( 'design', 'header', 'navigation', 'footer', 'media', 'motion', 'behavior' );
			if (
				! is_array( $configuration_component ) ||
				array() !== array_diff( $required_configuration, array_keys( $configuration_component ) )
			) {
				throw new SiteForge_Runtime_Exception(
					'siteforge_v3_site_configuration_incomplete',
					'The v3 site configuration must project design, header, navigation, footer, media, motion, and behavior.',
					422
				);
			}
			$configuration = $configuration_component;
		} else {
			// Compatibility for artifacts compiled before complete configuration
			// became a first-class v3 utility resource.
			$configuration = array(
				'header' => $header,
				'footer' => $footer,
			);
		}
		$configuration['header'] = $header;
		$configuration['footer'] = $footer;
		$configuration['globalComponents'] = $components;
		$configuration['chrome'] = $graph['chrome'];
		$this->persist_option( 'oneclick_siteforge_configuration', $configuration, 'chrome configuration' );
		if ( null !== $configuration_component ) {
			$design_tokens = $configuration['design'];
			$design_tokens['content_hash'] = SiteForge_Runtime_Validation::hash( $configuration['design'] );
			$this->persist_option( 'oneclick_siteforge_design_tokens', $design_tokens, 'design tokens' );
			$this->persist_option( 'oneclick_siteforge_motion', $configuration['motion'], 'motion options' );
		}
		$this->persist_option( self::FORMS_OPTION, $graph['forms'], 'forms' );
		$this->persist_option( self::REDIRECTS_OPTION, $graph['redirects'], 'redirects' );
		$this->persist_option( self::INTEGRATIONS_OPTION, $graph['integrations'], 'integrations' );
		$this->persist_option( self::LEGAL_OPTION, $graph['legal'], 'legal resources' );
		$this->persist_option( self::SEO_OPTION, $graph['seo'], 'SEO resources' );
		$this->persist_option( 'oneclick_siteforge_responsive_css_v3', $this->responsive_css( $graph['responsiveRules'] ), 'responsive layout rules' );
		$this->persist_option( 'oneclick_siteforge_legal', $this->legacy_legal_projection( $graph['legal'] ), 'legal surfaces' );
		$this->persist_option( 'oneclick_siteforge_analytics', $graph['analytics'], 'analytics' );
		$this->persist_option( 'oneclick_siteforge_target', $target, 'target' );
		$this->persist_option( 'oneclick_siteforge_target_mode', $target['environment'], 'target mode' );
		$this->persist_option( 'oneclick_siteforge_protection', $target['protection'], 'protection' );
		$this->persist_option( 'oneclick_siteforge_public_runtime', $target['publicRuntime'], 'public runtime' );
		$this->persist_option( 'oneclick_siteforge_lumaleasing', $this->public_runtime_projection( $target['publicRuntime'], $graph['integrations'] ), 'form runtime' );
		$this->persist_option( 'blog_public', 'public' === $target['protection']['mode'] ? '1' : '0', 'search visibility' );
	}

	private function apply_chrome( $graph, $page_ids, $site_id ) {
		$desired = array();
		foreach ( $graph['globalComponents'] as $component ) {
			if ( 'navigation' === $component['componentType'] ) {
				$desired[ $component['resourceId'] ] = $component;
			}
		}
		$owners = get_option( self::MENU_OWNERS_OPTION, array() );
		$owners = is_array( $owners ) ? $owners : array();
		foreach ( $owners as $resource_id => $owner ) {
			if ( isset( $owner['siteId'] ) && $site_id === $owner['siteId'] && ! isset( $desired[ $resource_id ] ) ) {
				if ( ! empty( $owner['menuId'] ) ) {
					wp_delete_nav_menu( absint( $owner['menuId'] ) );
				}
				unset( $owners[ $resource_id ] );
			}
		}
		$menu_ids = array();
		foreach ( $desired as $resource_id => $component ) {
			$data     = $component['data'];
			$name     = isset( $data['name'] ) && is_string( $data['name'] ) && '' !== trim( $data['name'] ) ? $data['name'] : 'SiteForge ' . $resource_id;
			$location = isset( $data['location'] ) && in_array( $data['location'], array( 'primary', 'footer' ), true ) ? $data['location'] : 'primary';
			$items    = isset( $data['items'] ) && is_array( $data['items'] ) ? array_values( $data['items'] ) : array();
			$menu     = wp_get_nav_menu_object( $name );
			$menu_id  = $menu ? absint( $menu->term_id ) : wp_create_nav_menu( $name );
			if ( is_wp_error( $menu_id ) || ! $menu_id ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_navigation_failed', 'Could not materialize a v3 navigation menu.', 500 );
			}
			foreach ( wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) ) ?: array() as $item ) {
				wp_delete_post( $item->ID, true );
			}
			$item_ids = array();
			$pending  = $items;
			while ( ! empty( $pending ) ) {
				$progress = false;
				foreach ( $pending as $index => $item ) {
					$item_key  = isset( $item['itemId'] ) ? (string) $item['itemId'] : ( isset( $item['id'] ) ? (string) $item['id'] : '' );
					if ( '' === $item_key || ! preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/', $item_key ) ) {
						throw new SiteForge_Runtime_Exception( 'siteforge_v3_navigation_identity_missing', 'Every v3 navigation item requires one stable explicit identity.', 422 );
					}
					if ( isset( $item_ids[ $item_key ] ) ) {
						throw new SiteForge_Runtime_Exception( 'siteforge_v3_navigation_identity_duplicate', 'V3 navigation item identities must be unique.', 422, array( 'itemId' => $item_key ) );
					}
					$parent_key= isset( $item['parentItemId'] ) ? (string) $item['parentItemId'] : ( isset( $item['parentId'] ) ? (string) $item['parentId'] : '' );
					if ( '' !== $parent_key && ! isset( $item_ids[ $parent_key ] ) ) {
						continue;
					}
					$args = array(
						'menu-item-title'     => isset( $item['label'] ) ? (string) $item['label'] : '',
						'menu-item-status'    => 'publish',
						'menu-item-position'  => $index + 1,
						'menu-item-parent-id' => '' === $parent_key ? 0 : $item_ids[ $parent_key ],
						'menu-item-target'    => isset( $item['target'] ) && '_blank' === $item['target'] ? '_blank' : '',
					);
					$page_resource_id = isset( $item['pageId'] ) ? (string) $item['pageId'] : '';
					if ( '' !== $page_resource_id ) {
						if ( ! isset( $page_ids[ $page_resource_id ] ) ) {
							throw new SiteForge_Runtime_Exception( 'siteforge_v3_navigation_page_missing', 'Navigation references an unknown v3 page.', 422 );
						}
						$args['menu-item-object-id'] = $page_ids[ $page_resource_id ];
						$args['menu-item-object']    = 'page';
						$args['menu-item-type']      = 'post_type';
					} else {
						$args['menu-item-url']  = isset( $item['href'] ) ? (string) $item['href'] : ( isset( $item['url'] ) ? (string) $item['url'] : '/' );
						$args['menu-item-type'] = 'custom';
					}
					$item_id = wp_update_nav_menu_item( $menu_id, 0, $args );
					if ( is_wp_error( $item_id ) || ! $item_id ) {
						throw new SiteForge_Runtime_Exception( 'siteforge_v3_navigation_failed', 'Could not materialize a v3 menu item.', 500 );
					}
					update_post_meta( $item_id, self::MENU_ITEM_META, $item_key );
					update_post_meta( $item_id, self::MENU_RESOURCE_META, $resource_id );
					$item_ids[ $item_key ] = absint( $item_id );
					unset( $pending[ $index ] );
					$progress = true;
				}
				if ( ! $progress ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_navigation_cycle', 'V3 navigation hierarchy contains a cycle or unknown parent.', 422 );
				}
			}
			$locations              = get_theme_mod( 'nav_menu_locations', array() );
			$locations              = is_array( $locations ) ? $locations : array();
			$locations[ $location ] = absint( $menu_id );
			set_theme_mod( 'nav_menu_locations', $locations );
			$owners[ $resource_id ] = array( 'siteId' => $site_id, 'menuId' => absint( $menu_id ), 'name' => $name, 'location' => $location );
			$menu_ids[ $resource_id ] = absint( $menu_id );
		}
		$this->persist_option( self::MENU_OWNERS_OPTION, $owners, 'menu ownership' );
		ksort( $menu_ids, SORT_STRING );
		return $menu_ids;
	}

	private function verification_spec( $graph, $identity, $target, $page_ids, $menu_ids, $resource_ids, $bindings, $site_id, $artifact_id ) {
		$sections = array();
		foreach ( $graph['sections'] as $section ) {
			$sections[ $section['resourceId'] ] = $section;
		}
		$forms = array();
		foreach ( $graph['forms'] as $form ) {
			$forms[ $form['resourceId'] ] = $form;
		}
		$integrations = array();
		foreach ( $graph['integrations'] as $integration ) {
			$integrations[ $integration['resourceId'] ] = $integration;
		}
		$seo = array();
		foreach ( $graph['seo'] as $entry ) {
			$seo[ $entry['resourceId'] ] = $entry;
		}
		$presentation = $this->presentation_maps( $graph );
		$pages = array();
		foreach ( $graph['pages'] as $page ) {
			$page_sections = array();
			foreach ( $page['sectionIds'] as $section_id ) {
				$page_sections[] = $sections[ $section_id ];
			}
			usort( $page_sections, static function ( $left, $right ) { return $left['order'] <=> $right['order']; } );
			$content = $this->render_sections( $page_sections, $forms, $integrations, $bindings, $presentation );
			$seo_spec = null !== $page['seoId'] ? $this->seo_spec( $seo[ $page['seoId'] ], $bindings ) : null;
			$actual = array(
				'resourceId' => $page['resourceId'],
				'siteId'     => $site_id,
				'artifactId' => $artifact_id,
				'hash'       => $page['contentHash'],
				'slug'       => $page['slug'],
				'title'      => $page['title'],
				'content'    => $content,
				'status'     => $page['status'],
				'menuOrder'  => $page['menuOrder'],
				'template'   => $page['template'],
				'seo'        => $seo_spec,
			);
			$pages[ $page['resourceId'] ] = array(
				'id'           => $page_ids[ $page['resourceId'] ],
				'readbackHash' => SiteForge_Runtime_Validation::hash( $actual ),
			);
		}
		$option_hashes = array();
		foreach ( array( 'oneclick_siteforge_configuration', 'oneclick_siteforge_design_tokens', 'oneclick_siteforge_motion', self::FORMS_OPTION, self::REDIRECTS_OPTION, self::INTEGRATIONS_OPTION, self::LEGAL_OPTION, self::SEO_OPTION, 'oneclick_siteforge_responsive_css_v3', 'oneclick_siteforge_legal', 'oneclick_siteforge_analytics', 'oneclick_siteforge_target', 'oneclick_siteforge_target_mode', 'oneclick_siteforge_protection', 'oneclick_siteforge_public_runtime', 'oneclick_siteforge_lumaleasing', 'blog_public', self::MENU_OWNERS_OPTION ) as $option ) {
			$option_hashes[ $option ] = SiteForge_Runtime_Validation::hash( get_option( $option, null ) );
		}
		$menus = array();
		foreach ( $menu_ids as $resource_id => $menu_id ) {
			$menus[ $resource_id ] = array( 'menuId' => $menu_id, 'hash' => $this->menu_readback_hash( $menu_id ) );
		}
		return array(
			'siteId'          => $site_id,
			'pages'           => $pages,
			'removedPages'    => array_values( array_map(
				static function ( $removal ) {
					return $removal['resourceId'];
				},
				array_values( array_filter( $graph['removals'], static function ( $removal ) { return 'page' === $removal['resourceKind']; } ) )
			) ),
			'homepageId'      => $page_ids[ $graph['homepagePageId'] ],
			'optionHashes'    => $option_hashes,
			'menus'           => $menus,
			'resourceIdsHash' => SiteForge_Runtime_Validation::hash( get_option( self::RESOURCE_IDS_OPTION, array() ) ),
			'targetHash'      => SiteForge_Runtime_Validation::hash( $target ),
			'theme'           => $this->expected_theme( $identity ),
		);
	}

	private function allocate_resource_ids( $graph, $page_ids, $menu_ids, $bindings, $site_id ) {
		$record = get_option( self::RESOURCE_IDS_OPTION, array() );
		if ( is_array( $record ) && ! empty( $record['siteId'] ) && $site_id !== $record['siteId'] ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_resource_ownership_conflict', 'Resource ID registry belongs to a different v3 site.', 409 );
		}
		$prior = is_array( $record ) && isset( $record['ids'] ) && is_array( $record['ids'] ) ? $record['ids'] : array();
		$ids   = array();
		$next  = 1000000;
		foreach ( $prior as $id ) {
			$next = max( $next, absint( $id ) + 1 );
		}
		foreach ( $this->graph_resources( $graph ) as $resource ) {
			$resource_id = $resource['resourceId'];
			if ( isset( $page_ids[ $resource_id ] ) ) {
				$ids[ $resource_id ] = absint( $page_ids[ $resource_id ] );
			} elseif ( isset( $menu_ids[ $resource_id ] ) ) {
				$ids[ $resource_id ] = absint( $menu_ids[ $resource_id ] );
			} elseif ( 'asset' === $resource['kind'] && isset( $bindings[ $resource['assetId'] ] ) ) {
				$ids[ $resource_id ] = absint( $bindings[ $resource['assetId'] ]['attachmentId'] );
			} elseif ( isset( $prior[ $resource_id ] ) ) {
				$ids[ $resource_id ] = absint( $prior[ $resource_id ] );
			} else {
				$ids[ $resource_id ] = $next++;
			}
		}
		ksort( $ids, SORT_STRING );
		$this->persist_option( self::RESOURCE_IDS_OPTION, array( 'siteId' => $site_id, 'ids' => $ids ), 'resource IDs' );
		return $ids;
	}

	private function graph_resources( $graph ) {
		$output = array();
		$kinds  = array(
			'pages' => 'page', 'sections' => 'section', 'globalComponents' => 'global_component',
			'forms' => 'form', 'redirects' => 'redirect', 'responsiveRules' => 'responsive_rule',
			'accessibilityAnnotations' => 'accessibility_annotation', 'seo' => 'seo', 'legal' => 'legal',
			'integrations' => 'integration', 'assets' => 'asset',
		);
		foreach ( $kinds as $collection => $kind ) {
			foreach ( $graph[ $collection ] as $resource ) {
				$resource['kind'] = $kind;
				$output[] = $resource;
			}
		}
		$chrome = $graph['chrome'];
		$chrome['kind'] = 'chrome';
		$output[] = $chrome;
		$analytics = $graph['analytics'];
		$analytics['kind'] = 'analytics';
		$output[] = $analytics;
		usort( $output, static function ( $left, $right ) { return strcmp( $left['resourceId'], $right['resourceId'] ); } );
		return $output;
	}

	private function assert_page_ownership( $graph, $site_id, $allow_legacy_adoption = false ) {
		$desired = array();
		foreach ( $graph['pages'] as $page ) {
			$desired[ $page['resourceId'] ] = true;
			$existing = get_page_by_path( $page['slug'], OBJECT, 'page' );
			if ( $existing ) {
				$owner = (string) get_post_meta( $existing->ID, self::PAGE_SITE_META, true );
				$resource_id = (string) get_post_meta( $existing->ID, self::PAGE_RESOURCE_META, true );
				$adoptable_legacy = '' === $owner && '' === $resource_id && $allow_legacy_adoption && $this->is_legacy_siteforge_page( $existing->ID );
				if ( ( $site_id !== $owner && ! $adoptable_legacy ) || ( '' !== $resource_id && $page['resourceId'] !== $resource_id ) ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_page_slug_conflict', 'A desired slug is not owned by this exact v3 site resource.', 409, array( 'slug' => $page['slug'] ) );
				}
			}
		}
		$removals = array();
		foreach ( $graph['removals'] as $removal ) {
			if ( 'page' === $removal['resourceKind'] ) {
				$removals[ $removal['resourceId'] ] = true;
			}
		}
		foreach ( $this->owned_page_ids( $site_id ) as $page_id ) {
			$resource_id = (string) get_post_meta( $page_id, self::PAGE_RESOURCE_META, true );
			if ( ! isset( $desired[ $resource_id ] ) && ! isset( $removals[ $resource_id ] ) && 'trash' !== get_post_status( $page_id ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_resource_incomplete', 'Complete v3 graph omitted an owned page without an exact removal tombstone.', 422, array( 'resourceId' => $resource_id ) );
			}
		}
	}

	private function is_legacy_siteforge_page( $page_id ) {
		$artifact_id = (string) get_post_meta( $page_id, '_siteforge_artifact_id', true );
		$content_hash = (string) get_post_meta( $page_id, '_siteforge_page_content_hash', true );
		return '' !== $artifact_id && '' !== $content_hash;
	}

	private function presentation_maps( $graph ) {
		$accessibility = array();
		foreach ( $graph['accessibilityAnnotations'] as $annotation ) {
			$target_id = $annotation['target']['resourceId'];
			if ( ! isset( $accessibility[ $target_id ] ) ) {
				$accessibility[ $target_id ] = array();
			}
			$accessibility[ $target_id ][] = $annotation;
		}
		return array( 'accessibility' => $accessibility );
	}

	private function responsive_css( $rules ) {
		$output = array();
		foreach ( $rules as $rule ) {
			$declarations = array();
			foreach ( $rule['declarations'] as $property => $value ) {
				if ( ! preg_match( '/^(?:--)?[a-z][a-z0-9-]*$/i', $property ) || preg_match( '/[{};<>]/', $value ) ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_responsive_rule_unsafe', 'Responsive layout declarations contain unsafe CSS.', 422, array( 'resourceId' => $rule['resourceId'] ) );
				}
				$declarations[] = strtolower( $property ) . ':' . $value;
			}
			$selector = '.siteforge-resource-' . sanitize_html_class( $rule['target']['resourceId'] );
			$css      = $selector . '{' . implode( ';', $declarations ) . '}';
			$queries  = array();
			if ( null !== $rule['minWidthPx'] ) {
				$queries[] = '(min-width:' . absint( $rule['minWidthPx'] ) . 'px)';
			}
			if ( null !== $rule['maxWidthPx'] ) {
				$queries[] = '(max-width:' . absint( $rule['maxWidthPx'] ) . 'px)';
			}
			$output[] = empty( $queries ) ? $css : '@media ' . implode( ' and ', $queries ) . '{' . $css . '}';
		}
		return implode( "\n", $output );
	}

	private function assert_inventory_fresh( $sections ) {
		$now = time();
		foreach ( $sections as $section ) {
			if ( 'acf/plans-availability' !== $section['blockName'] ) {
				continue;
			}
			$data = $section['data'];
			$rows = isset( $data['floor_plans'] ) && is_array( $data['floor_plans'] ) ? $data['floor_plans'] : array();
			$snapshot = isset( $data['inventory_snapshot'] ) && is_array( $data['inventory_snapshot'] ) ? $data['inventory_snapshot'] : array();
			if ( empty( $rows ) || empty( $snapshot['captured_at'] ) || ! SiteForge_Runtime_Validation::is_hash( isset( $snapshot['content_hash'] ) ? $snapshot['content_hash'] : null ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_inventory_unavailable', 'Floor-plan inventory is unavailable; refusing synthetic inventory.', 422, array( 'resourceId' => $section['resourceId'] ) );
			}
			$max_age = isset( $snapshot['max_age_hours'] ) ? max( 1, min( 168, absint( $snapshot['max_age_hours'] ) ) ) : 24;
			foreach ( $rows as $row ) {
				$source_at = isset( $row['source_updated_at'] ) ? $row['source_updated_at'] : ( isset( $row['effective_at'] ) ? $row['effective_at'] : null );
				$stale = isset( $row['pricingHiddenReason'] ) && 'stale_inventory' === $row['pricingHiddenReason'];
				$stale = $stale || ! is_string( $source_at ) || false === strtotime( $source_at ) || strtotime( $source_at ) < $now - ( $max_age * HOUR_IN_SECONDS );
				$stale = $stale || ( ! empty( $row['expires_at'] ) && strtotime( $row['expires_at'] ) <= $now );
				if ( $stale ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_inventory_stale', 'Floor-plan inventory is stale; refusing pricing and availability materialization.', 422, array( 'resourceId' => $section['resourceId'] ) );
				}
			}
		}
	}

	private function asset_bindings( $preparation_id ) {
		$preparation = $this->assets->get_preparation( $preparation_id );
		$output = array();
		foreach ( is_array( $preparation ) && isset( $preparation['assets'] ) ? $preparation['assets'] : array() as $asset ) {
			$output[ $asset['assetId'] ] = $asset;
		}
		return $output;
	}

	private function bind_assets( $value, $bindings ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( isset( $value['assetId'] ) && is_string( $value['assetId'] ) ) {
			if ( ! isset( $bindings[ $value['assetId'] ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_asset_not_prepared', 'A materialized resource references an unprepared asset.', 422, array( 'assetId' => $value['assetId'] ) );
			}
			return absint( $bindings[ $value['assetId'] ]['attachmentId'] );
		}
		foreach ( $value as $key => $item ) {
			$value[ $key ] = $this->bind_assets( $item, $bindings );
		}
		return $value;
	}

	private function legacy_legal_projection( $legal ) {
		$bodies = array();
		foreach ( $legal as $policy ) {
			$bodies[ $policy['policyType'] ] = $policy['body'];
		}
		return array(
			'policyBodies' => $bodies,
			'paths'        => array(),
			'privacyPath'  => '',
			'termsPath'    => '',
			'accessibilityPath' => '',
			'fairHousingDisclaimer' => isset( $bodies['fair_housing'] ) ? $bodies['fair_housing'] : '',
		);
	}

	private function public_runtime_projection( $runtime, $integrations ) {
		$provider = null;
		foreach ( $integrations as $integration ) {
			if ( in_array( 'form_submission', $integration['scopes'], true ) ) {
				$provider = $integration;
				break;
			}
		}
		$public_key = is_string( $runtime['conversionKey'] ) ? trim( $runtime['conversionKey'] ) : '';
		return array(
			'enabled'            => (bool) $runtime['enabled'],
			'apiKey'             => '',
			'apiBaseUrl'         => $runtime['apiBaseUrl'],
			'websiteId'          => $runtime['websiteId'],
			'conversionEndpoint' => $runtime['conversionEndpoint'],
			'conversionKey'      => $public_key,
			'telemetryEndpoint'  => $runtime['telemetryEndpoint'],
			'keyReference'       => $runtime['keyReference'],
			'integration'        => $provider,
		);
	}

	private function owned_page_ids( $site_id ) {
		$query = new WP_Query(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private', 'trash' ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_key'       => self::PAGE_SITE_META,
				'meta_value'     => $site_id,
			)
		);
		return array_values( array_map( 'absint', $query->posts ) );
	}

	private function find_owned_page( $resource_id, $site_id ) {
		$query = new WP_Query(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private', 'trash' ),
				'posts_per_page' => 2,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_query'     => array(
					'relation' => 'AND',
					array( 'key' => self::PAGE_RESOURCE_META, 'value' => $resource_id ),
					array( 'key' => self::PAGE_SITE_META, 'value' => $site_id ),
				),
			)
		);
		if ( count( $query->posts ) > 1 ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_page_identity_corrupt', 'Multiple pages claim the same v3 resource identity.', 409 );
		}
		return empty( $query->posts ) ? 0 : absint( $query->posts[0] );
	}

	private function persist_option( $option, $value, $label ) {
		$result = update_option( $option, $value, false );
		wp_cache_delete( $option, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		if ( false === $result && $value != get_option( $option, null ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_materialization_write_failed', 'Could not persist v3 ' . $label . '.', 500, array( 'option' => $option ) );
		}
	}

	private function managed_options() {
		return array(
			self::RESOURCE_IDS_OPTION, self::MENU_OWNERS_OPTION, self::FORMS_OPTION,
			self::REDIRECTS_OPTION, self::INTEGRATIONS_OPTION, self::LEGAL_OPTION, self::SEO_OPTION,
			'oneclick_siteforge_responsive_css_v3',
			'oneclick_siteforge_configuration', 'oneclick_siteforge_design_tokens', 'oneclick_siteforge_motion',
			'oneclick_siteforge_legal', 'oneclick_siteforge_analytics',
			'oneclick_siteforge_target', 'oneclick_siteforge_target_mode', 'oneclick_siteforge_protection',
			'oneclick_siteforge_public_runtime', 'oneclick_siteforge_lumaleasing', 'blog_public',
			'show_on_front', 'page_on_front',
		);
	}

	private function snapshot_owned_menus( $site_id ) {
		$owners = get_option( self::MENU_OWNERS_OPTION, array() );
		$output = array();
		foreach ( is_array( $owners ) ? $owners : array() as $resource_id => $owner ) {
			if ( ! isset( $owner['siteId'] ) || $site_id !== $owner['siteId'] || empty( $owner['menuId'] ) ) {
				continue;
			}
			$items = array();
			foreach ( wp_get_nav_menu_items( $owner['menuId'], array( 'post_status' => 'any' ) ) ?: array() as $item ) {
				$items[] = array(
					'title' => $item->title, 'url' => $item->url, 'objectId' => absint( $item->object_id ),
					'object' => $item->object, 'type' => $item->type, 'position' => absint( $item->menu_order ),
					'parentId' => absint( $item->menu_item_parent ), 'target' => $item->target,
					'itemId' => get_post_meta( $item->ID, self::MENU_ITEM_META, true ),
					'dbId' => absint( $item->ID ),
				);
			}
			$output[ $resource_id ] = array( 'owner' => $owner, 'items' => $items );
		}
		return $output;
	}

	private function restore_owned_menus( $site_id, $snapshots ) {
		$owners = get_option( self::MENU_OWNERS_OPTION, array() );
		foreach ( is_array( $owners ) ? $owners : array() as $resource_id => $owner ) {
			if ( isset( $owner['siteId'] ) && $site_id === $owner['siteId'] && ! isset( $snapshots[ $resource_id ] ) && ! empty( $owner['menuId'] ) ) {
				wp_delete_nav_menu( absint( $owner['menuId'] ) );
			}
		}
		$restored = array();
		foreach ( $snapshots as $resource_id => $snapshot ) {
			$owner   = $snapshot['owner'];
			$menu    = wp_get_nav_menu_object( $owner['name'] );
			$menu_id = $menu ? absint( $menu->term_id ) : wp_create_nav_menu( $owner['name'] );
			if ( is_wp_error( $menu_id ) || ! $menu_id ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_failed', 'Could not recreate a v3 menu.', 500 );
			}
			foreach ( wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) ) ?: array() as $item ) {
				wp_delete_post( $item->ID, true );
			}
			$new_ids = array();
			$pending = $snapshot['items'];
			while ( ! empty( $pending ) ) {
				$progress = false;
				foreach ( $pending as $index => $item ) {
					if ( $item['parentId'] && ! isset( $new_ids[ $item['parentId'] ] ) ) {
						continue;
					}
					$result = wp_update_nav_menu_item(
						$menu_id,
						0,
						array(
							'menu-item-title' => $item['title'], 'menu-item-url' => $item['url'],
							'menu-item-object-id' => $item['objectId'], 'menu-item-object' => $item['object'],
							'menu-item-type' => $item['type'], 'menu-item-status' => 'publish',
							'menu-item-position' => $item['position'], 'menu-item-target' => $item['target'],
							'menu-item-parent-id' => $item['parentId'] ? $new_ids[ $item['parentId'] ] : 0,
						)
					);
					if ( is_wp_error( $result ) || ! $result ) {
						throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_failed', 'Could not restore a v3 menu.', 500 );
					}
					update_post_meta( $result, self::MENU_ITEM_META, $item['itemId'] );
					$new_ids[ $item['dbId'] ] = absint( $result );
					unset( $pending[ $index ] );
					$progress = true;
				}
				if ( ! $progress ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_failed', 'Saved v3 menu hierarchy is invalid.', 500 );
				}
			}
			$owner           = $snapshot['owner'];
			$owner['menuId'] = absint( $menu_id );
			$restored[ $resource_id ] = $owner;
		}
		return $restored;
	}

	private function menu_readback_hash( $menu_id ) {
		$items = wp_get_nav_menu_items( $menu_id ) ?: array();
		$output = array();
		foreach ( $items as $item ) {
			$output[] = array(
				'itemId' => (string) get_post_meta( $item->ID, self::MENU_ITEM_META, true ),
				'title' => $item->title, 'url' => $item->url, 'objectId' => absint( $item->object_id ),
				'object' => $item->object, 'type' => $item->type, 'position' => absint( $item->menu_order ),
				'parentId' => absint( $item->menu_item_parent ), 'target' => $item->target,
			);
		}
		return SiteForge_Runtime_Validation::hash( $output );
	}

	private function restore_post_meta( $post_id, $metadata ) {
		foreach ( array_keys( get_post_meta( $post_id ) ) as $key ) {
			delete_post_meta( $post_id, $key );
		}
		foreach ( $metadata as $key => $values ) {
			foreach ( $values as $value ) {
				add_post_meta( $post_id, $key, maybe_unserialize( $value ) );
			}
		}
	}

	private function repair_active_spec_after_menu_restore( $restored_menus ) {
		$active = get_option( SiteForge_Runtime_V3_State::ACTIVE_OPTION, array() );
		if ( ! is_array( $active ) || ! isset( $active['materializationSpec'] ) || ! is_array( $active['materializationSpec'] ) ) {
			return;
		}
		foreach ( $restored_menus as $resource_id => $owner ) {
			$active['materializationSpec']['menus'][ $resource_id ] = array(
				'menuId' => $owner['menuId'],
				'hash'   => $this->menu_readback_hash( $owner['menuId'] ),
			);
		}
		$active['materializationSpec']['optionHashes'][ self::MENU_OWNERS_OPTION ] =
			SiteForge_Runtime_Validation::hash( get_option( self::MENU_OWNERS_OPTION, array() ) );
		$active['materializationSpec']['resourceIdsHash'] =
			SiteForge_Runtime_Validation::hash( get_option( self::RESOURCE_IDS_OPTION, array() ) );
		update_option( SiteForge_Runtime_V3_State::ACTIVE_OPTION, $active, false );
	}

	private function assert_snapshot( $snapshot, $restored_menus ) {
		$actual_ids = $this->owned_page_ids( $snapshot['siteId'] );
		$expected_ids = array_values( array_map( 'absint', array_keys( $snapshot['pages'] ) ) );
		sort( $actual_ids, SORT_NUMERIC );
		sort( $expected_ids, SORT_NUMERIC );
		if ( $actual_ids !== $expected_ids ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback page ownership readback failed.', 500 );
		}
		foreach ( $snapshot['options'] as $option => $saved ) {
			$expected = $saved['value'];
			if ( $saved['exists'] && self::MENU_OWNERS_OPTION === $option && is_array( $expected ) ) {
				foreach ( $restored_menus as $resource_id => $owner ) {
					$expected[ $resource_id ] = $owner;
				}
			}
			if ( $saved['exists'] && self::RESOURCE_IDS_OPTION === $option && is_array( $expected ) && isset( $expected['ids'] ) && is_array( $expected['ids'] ) ) {
				foreach ( $restored_menus as $resource_id => $owner ) {
					$expected['ids'][ $resource_id ] = $owner['menuId'];
				}
			}
			$sentinel = '__siteforge_v3_materializer_rollback_missing_' . $this->uuid();
			$actual   = get_option( $option, $sentinel );
			if ( (bool) $saved['exists'] !== ( $sentinel !== $actual ) || ( $saved['exists'] && $expected !== $actual ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback option readback failed.', 500, array( 'option' => $option ) );
			}
		}
		$expected_locations = $snapshot['navMenuLocations'];
		foreach ( $restored_menus as $owner ) {
			$expected_locations[ $owner['location'] ] = $owner['menuId'];
		}
		if ( $expected_locations !== get_theme_mod( 'nav_menu_locations', array() ) ) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback menu-location readback failed.', 500 );
		}
		if (
			$snapshot['activeTheme']['stylesheet'] !== get_stylesheet() ||
			$snapshot['activeTheme']['template'] !== get_template()
		) {
			throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback active-theme readback failed.', 500 );
		}
		foreach ( $snapshot['menus'] as $resource_id => $saved_menu ) {
			if ( ! isset( $restored_menus[ $resource_id ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback menu ownership readback failed.', 500, array( 'resourceId' => $resource_id ) );
			}
			$owner = $restored_menus[ $resource_id ];
			foreach ( array( 'siteId', 'name', 'location' ) as $field ) {
				if ( ! isset( $saved_menu['owner'][ $field ], $owner[ $field ] ) || $saved_menu['owner'][ $field ] !== $owner[ $field ] ) {
					throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback menu identity readback failed.', 500, array( 'resourceId' => $resource_id ) );
				}
			}
			$expected_hash = $this->menu_snapshot_hash( $saved_menu['items'] );
			$actual_hash   = $this->menu_snapshot_readback_hash( $owner['menuId'] );
			if ( null === $actual_hash || ! hash_equals( $expected_hash, $actual_hash ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback menu readback failed.', 500, array( 'resourceId' => $resource_id ) );
			}
		}
		$owners = get_option( self::MENU_OWNERS_OPTION, array() );
		foreach ( is_array( $owners ) ? $owners : array() as $resource_id => $owner ) {
			if ( isset( $owner['siteId'] ) && $snapshot['siteId'] === $owner['siteId'] && ! isset( $snapshot['menus'][ $resource_id ] ) ) {
				throw new SiteForge_Runtime_Exception( 'siteforge_v3_materializer_rollback_readback_failed', 'Rollback left an unexpected managed menu.', 500, array( 'resourceId' => $resource_id ) );
			}
		}
	}

	private function menu_snapshot_hash( $items ) {
		$db_ids = array();
		foreach ( $items as $item ) {
			$db_ids[ absint( $item['dbId'] ) ] = (string) $item['itemId'];
		}
		$output = array();
		foreach ( $items as $item ) {
			$parent_id = absint( $item['parentId'] );
			$output[] = array(
				'itemId'      => (string) $item['itemId'],
				'title'       => $item['title'],
				'url'         => $item['url'],
				'objectId'    => absint( $item['objectId'] ),
				'object'      => $item['object'],
				'type'        => $item['type'],
				'position'    => absint( $item['position'] ),
				'parentItemId'=> $parent_id && isset( $db_ids[ $parent_id ] ) ? $db_ids[ $parent_id ] : ( $parent_id ? '__missing_parent__' : '' ),
				'target'      => $item['target'],
			);
		}
		return SiteForge_Runtime_Validation::hash( $output );
	}

	private function menu_snapshot_readback_hash( $menu_id ) {
		$items = wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) );
		if ( false === $items ) {
			return null;
		}
		$db_ids = array();
		foreach ( $items as $item ) {
			$db_ids[ absint( $item->ID ) ] = (string) get_post_meta( $item->ID, self::MENU_ITEM_META, true );
		}
		$output = array();
		foreach ( $items as $item ) {
			$parent_id = absint( $item->menu_item_parent );
			$output[] = array(
				'itemId'      => (string) get_post_meta( $item->ID, self::MENU_ITEM_META, true ),
				'title'       => $item->title,
				'url'         => $item->url,
				'objectId'    => absint( $item->object_id ),
				'object'      => $item->object,
				'type'        => $item->type,
				'position'    => absint( $item->menu_order ),
				'parentItemId'=> $parent_id && isset( $db_ids[ $parent_id ] ) ? $db_ids[ $parent_id ] : ( $parent_id ? '__missing_parent__' : '' ),
				'target'      => $item->target,
			);
		}
		return SiteForge_Runtime_Validation::hash( $output );
	}

	private function check( $name, $passed, $message ) {
		return array( 'name' => $name, 'passed' => (bool) $passed, 'message' => $message );
	}

	private function expected_theme( $identity ) {
		$overlays = isset( $identity['overlays'] ) && is_array( $identity['overlays'] ) ? $identity['overlays'] : array();
		return array(
			'stylesheet'        => empty( $overlays ) ? 'oneclick-siteforge' : $overlays[0]['themeSlug'],
			'template'          => 'oneclick-siteforge',
			'requiresOverlayCss'=> ! empty( $overlays ),
		);
	}

	private function theme_readback() {
		if ( function_exists( 'do_action' ) ) {
			do_action( 'wp_enqueue_scripts' );
		}
		$stylesheet = get_stylesheet();
		$loaded = false;
		if ( function_exists( 'wp_styles' ) ) {
			$styles = wp_styles();
			foreach ( $styles->queue as $handle ) {
				$registered = isset( $styles->registered[ $handle ] ) ? $styles->registered[ $handle ] : null;
				$src = $registered ? (string) $registered->src : '';
				if ( false !== strpos( $src, '/themes/' . $stylesheet . '/' ) && false !== strpos( $src, '.css' ) ) {
					$loaded = true;
					break;
				}
			}
		}
		return array(
			'stylesheet'      => $stylesheet,
			'template'        => get_template(),
			'overlayCssLoaded'=> $loaded,
		);
	}

	private function uuid() {
		return function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'siteforge-v3-materializer-', true );
	}
}

