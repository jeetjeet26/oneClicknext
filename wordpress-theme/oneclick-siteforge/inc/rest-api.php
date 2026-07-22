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
}
add_action( 'rest_api_init', 'oneclick_siteforge_register_rest_routes' );

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
