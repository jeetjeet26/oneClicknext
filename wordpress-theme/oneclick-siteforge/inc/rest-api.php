<?php
/**
 * SiteForge REST API
 *
 * Exposes the theme's real capabilities so the SiteForge generation pipeline
 * discovers ground truth instead of relying on hardcoded fallbacks:
 *   GET /wp-json/siteforge/v1/abilities     - available ACF blocks + theme info
 *   GET /wp-json/siteforge/v1/acf-schemas   - field schemas from registered field groups
 *   GET /wp-json/siteforge/v1/design-tokens - design tokens from theme.json
 *
 * @package OneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Block names registered by oneclick_siteforge_register_acf_blocks().
 */
function oneclick_siteforge_rest_block_names() {
	return array(
		'top-slides',
		'text-section',
		'content-grid',
		'feature-section',
		'links',
		'plans-availability',
		'form',
		'gallery',
		'image',
		'map',
		'poi',
		'menu',
		'accordion-section',
		'html-section',
	);
}

function oneclick_siteforge_register_rest_routes() {
	register_rest_route(
		'siteforge/v1',
		'/abilities',
		array(
			'methods'             => 'GET',
			'callback'            => 'oneclick_siteforge_rest_abilities',
			'permission_callback' => '__return_true',
		)
	);

	register_rest_route(
		'siteforge/v1',
		'/acf-schemas',
		array(
			'methods'             => 'GET',
			'callback'            => 'oneclick_siteforge_rest_acf_schemas',
			'permission_callback' => '__return_true',
			'args'                => array(
				'block' => array(
					'type'     => 'string',
					'required' => false,
				),
			),
		)
	);

	register_rest_route(
		'siteforge/v1',
		'/design-tokens',
		array(
			'methods'             => 'GET',
			'callback'            => 'oneclick_siteforge_rest_design_tokens',
			'permission_callback' => '__return_true',
		)
	);

	register_rest_route(
		'siteforge/v1',
		'/settings',
		array(
			'methods'             => 'POST',
			'callback'            => 'oneclick_siteforge_rest_update_settings',
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		)
	);
	register_rest_route(
		'siteforge/v1',
		'/content-manifest',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'oneclick_siteforge_rest_content_manifest',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			),
			array(
				'methods'             => 'POST',
				'callback'            => 'oneclick_siteforge_rest_update_content_manifest',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
			),
		)
	);
	register_rest_route(
		'siteforge/v1',
		'/production-activation',
		array(
			'methods'             => 'POST',
			'callback'            => 'oneclick_siteforge_rest_activate_production',
			'permission_callback' => function () {
				return current_user_can( 'manage_options' );
			},
		)
	);
}
add_action( 'rest_api_init', 'oneclick_siteforge_register_rest_routes' );

function oneclick_siteforge_rest_content_manifest() {
	return rest_ensure_response(
		get_option(
			'oneclick_siteforge_content_manifest',
			array( 'content_hash' => null, 'page_ids' => array() )
		)
	);
}

function oneclick_siteforge_rest_update_content_manifest( WP_REST_Request $request ) {
	$content_hash = sanitize_text_field( (string) $request->get_param( 'content_hash' ) );
	$page_ids     = $request->get_param( 'page_ids' );
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $content_hash ) || ! is_array( $page_ids ) ) {
		return new WP_Error(
			'siteforge_invalid_content_manifest',
			'A valid artifact hash and page IDs are required.',
			array( 'status' => 400 )
		);
	}
	$page_ids = array_values( array_unique( array_filter( array_map( 'absint', $page_ids ) ) ) );
	$previous = get_option( 'oneclick_siteforge_content_manifest', array( 'page_ids' => array() ) );
	$previous_ids = isset( $previous['page_ids'] ) && is_array( $previous['page_ids'] )
		? array_map( 'absint', $previous['page_ids'] )
		: array();
	foreach ( array_diff( $previous_ids, $page_ids ) as $stale_page_id ) {
		if ( 'page' === get_post_type( $stale_page_id ) ) {
			wp_delete_post( $stale_page_id, true );
		}
	}
	$manifest = array(
		'content_hash' => $content_hash,
		'page_ids'     => $page_ids,
		'updated_at'   => gmdate( 'c' ),
	);
	update_option( 'oneclick_siteforge_content_manifest', $manifest, false );
	return rest_ensure_response( $manifest );
}

/**
 * Make an exact certified artifact indexable only after P11 verifies that the
 * operator-promoted production site still carries the approved manifest.
 */
function oneclick_siteforge_rest_activate_production( WP_REST_Request $request ) {
	$content_hash = sanitize_text_field( (string) $request->get_param( 'content_hash' ) );
	$manifest     = get_option( 'oneclick_siteforge_content_manifest', array() );
	$actual_hash  = sanitize_text_field( (string) ( $manifest['content_hash'] ?? '' ) );

	if ( ! preg_match( '/^[a-f0-9]{64}$/', $content_hash ) || ! hash_equals( $content_hash, $actual_hash ) ) {
		return new WP_Error(
			'siteforge_production_manifest_mismatch',
			'The promoted WordPress manifest does not match the approved artifact.',
			array( 'status' => 409 )
		);
	}

	update_option( 'blog_public', '1' );
	update_option( 'oneclick_siteforge_target_mode', 'production', false );
	update_option(
		'oneclick_siteforge_production_activation',
		array(
			'content_hash' => $content_hash,
			'activated_at' => gmdate( 'c' ),
		),
		false
	);

	return rest_ensure_response(
		array(
			'activated'    => true,
			'content_hash' => $content_hash,
			'blog_public'  => '1',
		)
	);
}

/**
 * Apply a checksummed design-token package from the durable deployment workflow.
 */
function oneclick_siteforge_rest_update_settings( WP_REST_Request $request ) {
	$tokens = $request->get_param( 'design_tokens' );
	$legal = $request->get_param( 'legal' );
	$analytics = $request->get_param( 'analytics' );
	$configuration = $request->get_param( 'site_configuration' );
	$motion = $request->get_param( 'motion' );
	$overlay = $request->get_param( 'theme_overlay' );
	$lumaleasing = $request->get_param( 'lumaleasing' );
	$target_mode = sanitize_key( (string) $request->get_param( 'target_mode' ) );
	$hash   = sanitize_text_field( (string) $request->get_param( 'content_hash' ) );
	if ( ! is_array( $tokens ) || ! is_array( $legal ) || ! is_array( $analytics ) || ! is_array( $configuration ) || ! is_array( $motion ) || ! is_array( $overlay ) || ! preg_match( '/^[a-f0-9]{64}$/', $hash ) ) {
		return new WP_Error(
			'siteforge_invalid_settings',
			'Design tokens and a valid artifact hash are required.',
			array( 'status' => 400 )
		);
	}

	$colors     = isset( $tokens['colors'] ) && is_array( $tokens['colors'] ) ? $tokens['colors'] : array();
	$typography = isset( $tokens['typography'] ) && is_array( $tokens['typography'] ) ? $tokens['typography'] : array();
	$spacing    = isset( $tokens['spacing'] ) && is_array( $tokens['spacing'] ) ? $tokens['spacing'] : array();
	$safe       = array(
		'content_hash' => $hash,
		'colors'       => array(
			'primary'    => sanitize_hex_color( $colors['primary'] ?? '' ),
			'secondary'  => sanitize_hex_color( $colors['secondary'] ?? '' ),
			'accent'     => sanitize_hex_color( $colors['accent'] ?? '' ),
			'background' => sanitize_hex_color( $colors['background'] ?? '' ),
			'text'       => sanitize_hex_color( $colors['text'] ?? ( $colors['primary'] ?? '' ) ),
		),
		'typography'   => array(
			'headingFont'   => oneclick_siteforge_sanitize_font_stack( $typography['headingFont'] ?? '' ),
			'headingWeight' => min( 900, max( 100, absint( $typography['headingWeight'] ?? 600 ) ) ),
			'bodyFont'      => oneclick_siteforge_sanitize_font_stack( $typography['bodyFont'] ?? '' ),
		),
		'spacing'      => array(
			'containerMaxWidth' => oneclick_siteforge_sanitize_css_dimension( $spacing['containerMaxWidth'] ?? '' ),
			'sectionPadding'    => oneclick_siteforge_sanitize_css_dimension( $spacing['sectionPadding'] ?? '' ),
		),
	);

	if ( in_array( false, $safe['colors'], true ) ) {
		return new WP_Error(
			'siteforge_invalid_colors',
			'Every SiteForge color token must be a six-digit hexadecimal color.',
			array( 'status' => 400 )
		);
	}
	$legal_paths = array(
		'privacyPath'       => $legal['privacyPath'] ?? '',
		'termsPath'         => $legal['termsPath'] ?? '',
		'accessibilityPath' => $legal['accessibilityPath'] ?? '',
	);
	foreach ( $legal_paths as $key => $path ) {
		$path = sanitize_text_field( (string) $path );
		if ( ! str_starts_with( $path, '/' ) ) {
			return new WP_Error( 'siteforge_invalid_legal_path', 'Legal paths must be site-relative.', array( 'status' => 400 ) );
		}
		$legal_paths[ $key ] = $path;
	}
	$safe_legal = array(
		'equalHousingOpportunity' => true,
		'fairHousingDisclaimer'   => sanitize_text_field( $legal['fairHousingDisclaimer'] ?? '' ),
		'paths'                   => $legal_paths,
	);
	$allowed_events = array( 'page_view', 'cta_click', 'floorplan_view', 'availability_click', 'lead_start', 'lead_submit', 'tour_start', 'tour_booked' );
	$events = isset( $analytics['events'] ) && is_array( $analytics['events'] )
		? array_values( array_intersect( $allowed_events, array_map( 'sanitize_key', $analytics['events'] ) ) )
		: array();
	if ( 'required' !== ( $analytics['consentMode'] ?? '' ) || count( $events ) !== count( $allowed_events ) ) {
		return new WP_Error( 'siteforge_invalid_analytics', 'Required consent mode and conversion events are missing.', array( 'status' => 400 ) );
	}
	$consent_policy_version = sanitize_text_field( $analytics['policyVersion'] ?? 'siteforge-consent-v1' );
	if ( ! preg_match( '/^[a-zA-Z0-9._-]{3,100}$/', $consent_policy_version ) ) {
		return new WP_Error( 'siteforge_invalid_consent_policy', 'Consent policy version is invalid.', array( 'status' => 400 ) );
	}
	update_option( 'oneclick_siteforge_design_tokens', $safe, false );
	update_option( 'oneclick_siteforge_configuration', oneclick_siteforge_sanitize_configuration( $configuration ), false );
	update_option( 'oneclick_siteforge_motion', oneclick_siteforge_sanitize_motion( $motion ), false );
	update_option(
		'oneclick_siteforge_theme_overlay',
		array(
			'manifestVersion' => 1,
			'contentHash'     => preg_match( '/^[a-f0-9]{64}$/', $overlay['contentHash'] ?? '' ) ? $overlay['contentHash'] : '',
			'files'           => array_values(
				array_map(
					static function ( $file ) {
						return array(
							'path'        => sanitize_text_field( $file['path'] ?? '' ),
							'mediaType'   => sanitize_text_field( $file['mediaType'] ?? '' ),
							'contentHash' => preg_match( '/^[a-f0-9]{64}$/', $file['contentHash'] ?? '' ) ? $file['contentHash'] : '',
							'bytes'       => absint( $file['bytes'] ?? 0 ),
						);
					},
					is_array( $overlay['files'] ?? null ) ? $overlay['files'] : array()
				)
			),
		),
		false
	);
	update_option( 'oneclick_siteforge_legal', $safe_legal, false );
	update_option(
		'oneclick_siteforge_analytics',
		array(
			'consentMode' => 'required',
			'events'      => $events,
			'policyVersion' => $consent_policy_version,
			'consentText' => sanitize_text_field(
				$analytics['consentText'] ?? 'We use first-party analytics to understand website usage and improve your experience.'
			),
			'region'      => sanitize_key( $analytics['region'] ?? 'default' ),
			'categories'  => array( 'necessary' => true, 'analytics' => true ),
		),
		false
	);
	if ( is_array( $lumaleasing ) ) {
		$api_base = esc_url_raw( $lumaleasing['apiBaseUrl'] ?? '' );
		$conversion_endpoint = esc_url_raw( $lumaleasing['conversionEndpoint'] ?? '' );
		$telemetry_endpoint = esc_url_raw( $lumaleasing['telemetryEndpoint'] ?? '' );
		$website_id = sanitize_text_field( $lumaleasing['websiteId'] ?? '' );
		$api_key = sanitize_text_field( $lumaleasing['apiKey'] ?? '' );
		$conversion_key = sanitize_text_field( $lumaleasing['conversionKey'] ?? '' );
		if (
			! preg_match( '#^https://#', $api_base ) ||
			! preg_match( '#^https://#', $conversion_endpoint ) ||
			! preg_match( '#^https://#', $telemetry_endpoint ) ||
			! wp_is_uuid( $website_id ) ||
			'' === $conversion_key ||
			( ! empty( $lumaleasing['enabled'] ) && '' === $api_key )
		) {
			return new WP_Error( 'siteforge_invalid_lumaleasing', 'Certified LumaLeasing settings are incomplete or invalid.', array( 'status' => 400 ) );
		}
		update_option(
			'oneclick_siteforge_lumaleasing',
			array(
				'enabled'             => ! empty( $lumaleasing['enabled'] ),
				'apiKey'              => $api_key,
				'apiBaseUrl'          => untrailingslashit( $api_base ),
				'websiteId'           => $website_id,
				'conversionEndpoint'  => $conversion_endpoint,
				'conversionKey'       => $conversion_key,
				'telemetryEndpoint'   => $telemetry_endpoint,
				'certifiedContentHash'=> $hash,
			),
			false
		);
	}
	if ( ! in_array( $target_mode, array( 'canonical_preview', 'staging' ), true ) ) {
		return new WP_Error( 'siteforge_invalid_target_mode', 'A non-production SiteForge target mode is required.', array( 'status' => 400 ) );
	}
	update_option( 'blog_public', '0' );
	update_option( 'oneclick_siteforge_target_mode', $target_mode, false );
	return rest_ensure_response( array( 'updated' => true, 'content_hash' => $hash ) );
}

function oneclick_siteforge_sanitize_css_dimension( $value ) {
	$value = sanitize_text_field( (string) $value );
	return preg_match( '/^\d+(?:\.\d+)?(?:px|rem|em|vw|%)$/', $value ) ? $value : '';
}

function oneclick_siteforge_sanitize_font_stack( $value ) {
	$value = sanitize_text_field( (string) $value );
	return preg_match( '/^[a-z0-9 ,"\'-]+$/i', $value ) ? $value : '';
}

function oneclick_siteforge_sanitize_motion( $motion ) {
	$allowed_levels = array( 'none', 'subtle', 'prominent' );
	$allowed_reveals = array( 'none', 'fade', 'slide', 'scale' );
	$allowed_easing = array( 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out' );
	return array(
		'level'         => in_array( $motion['level'] ?? '', $allowed_levels, true ) ? $motion['level'] : 'none',
		'reducedMotion' => 'disable' === ( $motion['reducedMotion'] ?? '' ) ? 'disable' : 'respect',
		'reveal'        => in_array( $motion['reveal'] ?? '', $allowed_reveals, true ) ? $motion['reveal'] : 'none',
		'durationMs'    => min( 5000, absint( $motion['durationMs'] ?? 0 ) ),
		'easing'        => in_array( $motion['easing'] ?? '', $allowed_easing, true ) ? $motion['easing'] : 'ease',
	);
}

function oneclick_siteforge_sanitize_configuration( $configuration ) {
	$header = is_array( $configuration['header'] ?? null ) ? $configuration['header'] : array();
	$navigation = is_array( $configuration['navigation'] ?? null ) ? $configuration['navigation'] : array();
	$footer = is_array( $configuration['footer'] ?? null ) ? $configuration['footer'] : array();
	$media = is_array( $configuration['media'] ?? null ) ? $configuration['media'] : array();
	$behavior = is_array( $configuration['behavior'] ?? null ) ? $configuration['behavior'] : array();
	$items = array();
	foreach ( is_array( $navigation['items'] ?? null ) ? $navigation['items'] : array() as $item ) {
		$items[] = array(
			'id'       => sanitize_key( $item['id'] ?? '' ),
			'label'    => sanitize_text_field( $item['label'] ?? '' ),
			'href'     => esc_url_raw( $item['href'] ?? '' ),
			'parentId' => sanitize_key( $item['parentId'] ?? '' ),
			'external' => ! empty( $item['external'] ),
		);
	}
	return array(
		'header' => array(
			'layout'       => sanitize_key( $header['layout'] ?? 'logo-left' ),
			'position'     => sanitize_key( $header['position'] ?? 'static' ),
			'announcement' => array(
				'enabled' => ! empty( $header['announcement']['enabled'] ),
				'text'    => sanitize_text_field( $header['announcement']['text'] ?? '' ),
				'link'    => esc_url_raw( $header['announcement']['link'] ?? '' ),
			),
			'cta'          => array(
				'enabled' => ! empty( $header['cta']['enabled'] ),
				'label'   => sanitize_text_field( $header['cta']['label'] ?? '' ),
				'href'    => esc_url_raw( $header['cta']['href'] ?? '' ),
			),
		),
		'navigation' => array(
			'style' => sanitize_key( $navigation['style'] ?? 'horizontal' ),
			'items' => $items,
		),
		'footer' => array(
			'layout'         => sanitize_key( $footer['layout'] ?? 'columns' ),
			'showNavigation' => ! empty( $footer['showNavigation'] ),
			'showContact'    => ! empty( $footer['showContact'] ),
			'showSocial'     => ! empty( $footer['showSocial'] ),
			'tagline'        => sanitize_text_field( $footer['tagline'] ?? '' ),
		),
		'media' => array(
			'logoUrl'        => esc_url_raw( $media['logoUrl'] ?? '' ),
			'logoAlt'        => sanitize_text_field( $media['logoAlt'] ?? '' ),
			'faviconUrl'     => esc_url_raw( $media['faviconUrl'] ?? '' ),
			'defaultImageUrl'=> esc_url_raw( $media['defaultImageUrl'] ?? '' ),
			'imageTreatment' => sanitize_key( $media['imageTreatment'] ?? 'natural' ),
		),
		'motion'   => oneclick_siteforge_sanitize_motion( $configuration['motion'] ?? array() ),
		'behavior' => array(
			'smoothScroll'          => ! empty( $behavior['smoothScroll'] ),
			'externalLinksNewTab'   => ! empty( $behavior['externalLinksNewTab'] ),
			'backToTop'             => ! empty( $behavior['backToTop'] ),
			'cookieConsent'         => sanitize_key( $behavior['cookieConsent'] ?? 'required' ),
		),
	);
}

/**
 * GET /siteforge/v1/abilities
 */
function oneclick_siteforge_rest_abilities() {
	$theme  = wp_get_theme();
	$blocks = array_map(
		function ( $name ) {
			return 'acf/' . $name;
		},
		oneclick_siteforge_rest_block_names()
	);

	return rest_ensure_response(
		array(
			'available_blocks' => $blocks,
			'theme'            => array(
				'name'     => $theme->get_stylesheet(),
				'version'  => $theme->get( 'Version' ),
				'supports' => array(
					'acf_blocks'      => function_exists( 'acf_register_block_type' ),
					'classic_menus'   => true,
					'block_templates' => false,
				),
			),
			'plugins'          => oneclick_siteforge_rest_active_plugins(),
			'capabilities'     => array(
				'can_create_pages'   => true,
				'can_upload_media'   => true,
				'can_modify_theme'   => false,
				'can_install_plugins' => false,
				'max_upload_size_mb' => (int) floor( wp_max_upload_size() / MB_IN_BYTES ),
			),
			'timestamp'        => gmdate( 'c' ),
		)
	);
}

/**
 * GET /siteforge/v1/acf-schemas
 *
 * Builds block schemas from the ACF field groups registered for each block
 * (loaded from the theme's acf-json directory), so the schema the generation
 * pipeline sees is exactly what the render templates hydrate.
 */
function oneclick_siteforge_rest_acf_schemas( WP_REST_Request $request ) {
	if ( ! function_exists( 'acf_get_field_groups' ) ) {
		return new WP_Error(
			'siteforge_acf_missing',
			'ACF is not active on this WordPress instance',
			array( 'status' => 501 )
		);
	}

	$requested_block = $request->get_param( 'block' );
	$schemas         = array();

	foreach ( oneclick_siteforge_rest_block_names() as $block_name ) {
		$full_name = 'acf/' . $block_name;

		if ( $requested_block && $requested_block !== $full_name && $requested_block !== $block_name ) {
			continue;
		}

		$groups = acf_get_field_groups( array( 'block' => $full_name ) );
		$fields = array();

		foreach ( $groups as $group ) {
			$group_fields = acf_get_fields( $group['key'] );
			if ( is_array( $group_fields ) ) {
				foreach ( $group_fields as $field ) {
					$fields[ $field['name'] ] = oneclick_siteforge_rest_field_schema( $field );
				}
			}
		}

		$schemas[ $full_name ] = array(
			'label'       => oneclick_siteforge_get_block_title( $block_name ),
			'description' => oneclick_siteforge_get_block_description( $block_name ),
			'fields'      => $fields,
		);
	}

	return rest_ensure_response( $schemas );
}

/**
 * Convert an ACF field definition into a serializable schema entry.
 */
function oneclick_siteforge_rest_field_schema( $field ) {
	$schema = array(
		'type'     => $field['type'],
		'required' => ! empty( $field['required'] ),
	);

	if ( ! empty( $field['default_value'] ) ) {
		$schema['default'] = $field['default_value'];
	}

	if ( ! empty( $field['choices'] ) && is_array( $field['choices'] ) ) {
		$schema['choices'] = array_keys( $field['choices'] );
	}

	if ( isset( $field['min'] ) && '' !== $field['min'] ) {
		$schema['min'] = $field['min'];
	}

	if ( isset( $field['max'] ) && '' !== $field['max'] ) {
		$schema['max'] = $field['max'];
	}

	if ( ! empty( $field['instructions'] ) ) {
		$schema['description'] = $field['instructions'];
	}

	if ( 'repeater' === $field['type'] && ! empty( $field['sub_fields'] ) ) {
		$sub_fields = array();
		foreach ( $field['sub_fields'] as $sub_field ) {
			$sub_fields[ $sub_field['name'] ] = oneclick_siteforge_rest_field_schema( $sub_field );
		}
		$schema['sub_fields'] = $sub_fields;
	}

	return $schema;
}

/**
 * GET /siteforge/v1/design-tokens
 */
function oneclick_siteforge_rest_design_tokens() {
	$colors     = array();
	$fonts      = array();
	$theme_json = ONECLICK_SITEFORGE_DIR . '/theme.json';

	if ( file_exists( $theme_json ) ) {
		$settings = json_decode( file_get_contents( $theme_json ), true );

		if ( isset( $settings['settings']['color']['palette'] ) ) {
			foreach ( $settings['settings']['color']['palette'] as $entry ) {
				$colors[ $entry['slug'] ] = $entry['color'];
			}
		}

		if ( isset( $settings['settings']['typography']['fontFamilies'] ) ) {
			foreach ( $settings['settings']['typography']['fontFamilies'] as $entry ) {
				if ( ! empty( $entry['name'] ) ) {
					$fonts[] = $entry['name'];
				}
			}
		}
	}

	return rest_ensure_response(
		array(
			'colors'     => array(
				'primary'            => isset( $colors['primary'] ) ? $colors['primary'] : '#1a1a1a',
				'secondary'          => isset( $colors['secondary'] ) ? $colors['secondary'] : '#c9a96e',
				'palette'            => $colors,
				'available_variants' => array_keys( $colors ),
			),
			'typography' => array(
				'available_fonts' => $fonts,
				'heading_scales'  => array( 'compact', 'balanced', 'luxury' ),
			),
			'spacing'    => array(
				'available_scales' => array( 'tight', 'balanced', 'luxury' ),
				'presets'          => array(
					'tight'    => array( 'section' => '4rem', 'container' => '1200px' ),
					'balanced' => array( 'section' => '6rem', 'container' => '1400px' ),
					'luxury'   => array( 'section' => '8rem', 'container' => '1600px' ),
				),
			),
		)
	);
}

/**
 * Active plugin slugs (best effort; plugin.php only loads in admin context).
 */
function oneclick_siteforge_rest_active_plugins() {
	$active = (array) get_option( 'active_plugins', array() );
	return array_values(
		array_map(
			function ( $plugin ) {
				return dirname( $plugin );
			},
			$active
		)
	);
}
