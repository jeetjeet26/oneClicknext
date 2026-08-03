<?php
/**
 * oneClick SiteForge Theme Functions
 *
 * @package OneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ONECLICK_SITEFORGE_VERSION', '2.2.7' );
define( 'ONECLICK_SITEFORGE_DIR', get_template_directory() );
define( 'ONECLICK_SITEFORGE_URI', get_template_directory_uri() );

/**
 * Keep ACF field-group contracts versioned with the theme.
 */
function oneclick_siteforge_acf_json_save_path() {
	return ONECLICK_SITEFORGE_DIR . '/acf-json';
}
add_filter( 'acf/settings/save_json', 'oneclick_siteforge_acf_json_save_path' );

function oneclick_siteforge_acf_json_load_paths( $paths ) {
	$paths[] = ONECLICK_SITEFORGE_DIR . '/acf-json';
	return array_values( array_unique( $paths ) );
}
add_filter( 'acf/settings/load_json', 'oneclick_siteforge_acf_json_load_paths' );

/**
 * Theme Setup
 */
function oneclick_siteforge_setup() {
	load_theme_textdomain( 'oneclick-siteforge', ONECLICK_SITEFORGE_DIR . '/languages' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support(
		'custom-logo',
		array(
			'height'      => 180,
			'width'       => 520,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'woocommerce' );

	register_nav_menus(
		array(
			'primary' => esc_html__( 'Primary Menu', 'oneclick-siteforge' ),
			'footer'  => esc_html__( 'Footer Menu', 'oneclick-siteforge' ),
		)
	);
}
add_action( 'after_setup_theme', 'oneclick_siteforge_setup' );

/**
 * Enqueue Theme Styles and Scripts
 */
function oneclick_siteforge_enqueue_assets() {
	// Google Fonts
	wp_enqueue_style(
		'google-fonts',
		'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap',
		array(),
		null
	);

	// Theme Stylesheet
	wp_enqueue_style(
		'oneclick-siteforge-style',
		ONECLICK_SITEFORGE_URI . '/style.css',
		array( 'google-fonts' ),
		ONECLICK_SITEFORGE_VERSION
	);

	$siteforge_tokens = get_option( 'oneclick_siteforge_design_tokens', array() );
	$siteforge_configuration = get_option( 'oneclick_siteforge_configuration', array() );
	$siteforge_motion = get_option( 'oneclick_siteforge_motion', array() );
	if ( is_array( $siteforge_tokens ) && ! empty( $siteforge_tokens['content_hash'] ) ) {
		$colors     = $siteforge_tokens['colors'] ?? array();
		$typography = $siteforge_tokens['typography'] ?? array();
		$spacing    = $siteforge_tokens['spacing'] ?? array();
		$token_css  = sprintf(
			'html:root{--color-primary:%1$s;--color-secondary:%2$s;--color-accent:%3$s;--color-background:%4$s;--color-bg:%4$s;--font-heading:%5$s;--font-body:%6$s;--container-max-width:%7$s;--max-width:%7$s;--section-padding:%8$s;--spacing-xxl:%8$s;--color-text:%9$s;}',
			$colors['primary'] ?? '#1a1a1a',
			$colors['secondary'] ?? '#c9a96e',
			$colors['accent'] ?? '#8a6d3b',
			$colors['background'] ?? '#ffffff',
			$typography['headingFont'] ?? '"Cormorant Garamond", serif',
			$typography['bodyFont'] ?? 'Inter, sans-serif',
			$spacing['containerMaxWidth'] ?? '1400px',
			$spacing['sectionPadding'] ?? '6rem',
			$colors['text'] ?? ( $colors['primary'] ?? '#1a1a1a' )
		);
		wp_add_inline_style( 'oneclick-siteforge-style', $token_css );
	}
	if ( is_array( $siteforge_motion ) ) {
		$motion_css = sprintf(
			':root{--siteforge-motion-duration:%dms;--siteforge-motion-easing:%s;}',
			min( 5000, absint( $siteforge_motion['durationMs'] ?? 0 ) ),
			in_array( $siteforge_motion['easing'] ?? '', array( 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out' ), true ) ? $siteforge_motion['easing'] : 'ease'
		);
		wp_add_inline_style( 'oneclick-siteforge-style', $motion_css );
	}

	// Block Styles
	wp_enqueue_style(
		'oneclick-siteforge-blocks',
		ONECLICK_SITEFORGE_URI . '/assets/css/blocks.css',
		array( 'oneclick-siteforge-style' ),
		ONECLICK_SITEFORGE_VERSION
	);

	// Layout Styles
	wp_enqueue_style(
		'oneclick-siteforge-layout',
		ONECLICK_SITEFORGE_URI . '/assets/css/layout.css',
		array( 'oneclick-siteforge-style' ),
		ONECLICK_SITEFORGE_VERSION
	);

	// FontAwesome 6
	wp_enqueue_style(
		'fontawesome-6',
		'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
		array(),
		'6.4.0'
	);

	// Swiper.js for slider
	wp_enqueue_script(
		'swiper-js',
		'https://cdn.jsdelivr.net/npm/swiper@10.3.1/swiper-bundle.min.js',
		array(),
		'10.3.1',
		true
	);

	wp_enqueue_style(
		'swiper-css',
		'https://cdn.jsdelivr.net/npm/swiper@10.3.1/swiper-bundle.min.css',
		array(),
		'10.3.1'
	);

	// GLightbox for gallery lightbox
	wp_enqueue_script(
		'glightbox-js',
		'https://cdn.jsdelivr.net/npm/glightbox@3.2.0/dist/glightbox.min.js',
		array(),
		'3.2.0',
		true
	);

	wp_enqueue_style(
		'glightbox-css',
		'https://cdn.jsdelivr.net/npm/glightbox@3.2.0/dist/glightbox.min.css',
		array(),
		'3.2.0'
	);

	// Google Maps API (loaded conditionally in block)
	// No global enqueue - loaded per-page as needed

	// Theme Scripts
	wp_enqueue_script(
		'oneclick-siteforge-slider',
		ONECLICK_SITEFORGE_URI . '/assets/js/slider.js',
		array( 'swiper-js' ),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	wp_enqueue_script(
		'oneclick-siteforge-accordion',
		ONECLICK_SITEFORGE_URI . '/assets/js/accordion.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	wp_enqueue_script(
		'oneclick-siteforge-gallery',
		ONECLICK_SITEFORGE_URI . '/assets/js/gallery.js',
		array( 'glightbox-js' ),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	wp_enqueue_script(
		'oneclick-siteforge-poi-map',
		ONECLICK_SITEFORGE_URI . '/assets/js/poi-map.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	wp_enqueue_script(
		'oneclick-siteforge-plans',
		ONECLICK_SITEFORGE_URI . '/assets/js/plans.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	wp_enqueue_script(
		'oneclick-siteforge-form-handler',
		ONECLICK_SITEFORGE_URI . '/assets/js/form-handler.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	$lumaleasing = oneclick_siteforge_lumaleasing_configuration();
	if ( ! empty( $lumaleasing['enabled'] ) && ! empty( $lumaleasing['apiKey'] ) && ! empty( $lumaleasing['apiBaseUrl'] ) ) {
		$widget_url = trailingslashit( $lumaleasing['apiBaseUrl'] ) . 'lumaleasing.js';
		wp_enqueue_script(
			'oneclick-siteforge-lumaleasing',
			$widget_url,
			array(),
			null,
			true
		);
		wp_add_inline_script(
			'oneclick-siteforge-lumaleasing',
			'window.LUMALEASING_API_BASE=' . wp_json_encode( $lumaleasing['apiBaseUrl'] ) . ';window.lumaleasing=window.lumaleasing||function(){(window.lumaleasing.q=window.lumaleasing.q||[]).push(arguments)};window.lumaleasing("init",' . wp_json_encode( $lumaleasing['apiKey'] ) . ');',
			'before'
		);
	}

	wp_enqueue_script(
		'oneclick-siteforge-mobile-menu',
		ONECLICK_SITEFORGE_URI . '/assets/js/mobile-menu.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);

	wp_enqueue_script(
		'oneclick-siteforge-site-behavior',
		ONECLICK_SITEFORGE_URI . '/assets/js/site-behavior.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);
	wp_localize_script(
		'oneclick-siteforge-site-behavior',
		'oneClickSiteConfiguration',
		is_array( $siteforge_configuration ) ? $siteforge_configuration : array()
	);

	wp_enqueue_script(
		'oneclick-siteforge-analytics',
		ONECLICK_SITEFORGE_URI . '/assets/js/analytics.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
	);
	$siteforge_analytics = get_option(
		'oneclick_siteforge_analytics',
		array( 'consentMode' => 'required', 'events' => array() )
	);
	$siteforge_runtime = oneclick_siteforge_lumaleasing_configuration();
	$siteforge_manifest = get_option( 'oneclick_siteforge_content_manifest', array() );
	$siteforge_analytics = array_merge(
		is_array( $siteforge_analytics ) ? $siteforge_analytics : array(),
		array(
			'endpoint'    => $siteforge_runtime['telemetryEndpoint'],
			'publicKey'   => $siteforge_runtime['conversionKey'],
			'websiteId'   => $siteforge_runtime['websiteId'],
			'contentHash' => sanitize_text_field( $siteforge_manifest['content_hash'] ?? '' ),
		)
	);
	wp_localize_script(
		'oneclick-siteforge-analytics',
		'oneClickAnalytics',
		$siteforge_analytics
	);

	wp_localize_script(
		'oneclick-siteforge-poi-map',
		'oneClickSettings',
		array(
			'googleMapsApiKey' => get_field( 'google_maps_api_key', 'option' ),
			'propertyAddress'  => get_field( 'property_address', 'option' ),
			'propertyLat'      => get_field( 'property_latitude', 'option' ),
			'propertyLng'      => get_field( 'property_longitude', 'option' ),
		)
	);

	wp_localize_script(
		'oneclick-siteforge-plans',
		'oneClickPlansSettings',
		array(
			'yardi_url'   => get_field( 'yardi_api_url', 'option' ),
			'rentcafe_url' => get_field( 'rentcafe_api_url', 'option' ),
		)
	);
}
add_action( 'wp_enqueue_scripts', 'oneclick_siteforge_enqueue_assets' );

/**
 * Register ACF Blocks
 */
function oneclick_siteforge_register_acf_blocks() {
	$blocks = array(
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

	foreach ( $blocks as $block ) {
		if ( function_exists( 'acf_register_block_type' ) ) {
			acf_register_block_type(
				array(
					'name'             => $block,
					'title'            => oneclick_siteforge_get_block_title( $block ),
					'description'      => oneclick_siteforge_get_block_description( $block ),
					'render_template'  => ONECLICK_SITEFORGE_DIR . '/blocks/' . $block . '.php',
					'category'         => 'oneclicksiteforge',
					'icon'             => oneclick_siteforge_get_block_icon( $block ),
					'keywords'         => array( $block ),
					'supports'         => array(
						'anchor'  => true,
						'align'   => array( 'full', 'wide' ),
						'mode'    => 'preview',
					),
				)
			);
		}
	}
}
add_action( 'acf/init', 'oneclick_siteforge_register_acf_blocks' );

/**
 * Get Block Title
 */
function oneclick_siteforge_get_block_title( $block_name ) {
	$titles = array(
		'top-slides'         => 'Hero Image Slider',
		'text-section'       => 'Rich Text Content',
		'content-grid'       => 'Card Grid Layout',
		'feature-section'    => 'Image + Text Split',
		'links'              => 'CTA Button Group',
		'plans-availability' => 'Floor Plan Browser',
		'form'               => 'Lead Capture Form',
		'gallery'            => 'Photo Gallery',
		'image'              => 'Single Hero Image',
		'map'                => 'Google Maps Embed',
		'poi'                => 'Points of Interest Map',
		'menu'               => 'Sub-Navigation',
		'accordion-section'  => 'Expandable FAQ/List',
		'html-section'       => 'Raw HTML',
	);

	return isset( $titles[ $block_name ] ) ? $titles[ $block_name ] : $block_name;
}

/**
 * Get Block Description
 */
function oneclick_siteforge_get_block_description( $block_name ) {
	$descriptions = array(
		'top-slides'         => 'Full-width image slider with text overlay and CTA button',
		'text-section'       => 'Centered or left-aligned rich text content block',
		'content-grid'       => 'Responsive card grid with icons/images and text',
		'feature-section'    => 'Two-column layout with image and text content',
		'links'              => 'Group of styled CTA buttons',
		'plans-availability' => 'Interactive floor plan browser with filters',
		'form'               => 'Lead capture form (contact/tour request)',
		'gallery'            => 'Responsive photo gallery with lightbox',
		'image'              => 'Full-width or contained image with caption',
		'map'                => 'Google Maps embed for property location',
		'poi'                => 'Interactive map with points of interest',
		'menu'               => 'Horizontal navigation menu for in-page sections',
		'accordion-section'  => 'Expandable accordion for FAQ or lists',
		'html-section'       => 'Raw HTML for custom embeds',
	);

	return isset( $descriptions[ $block_name ] ) ? $descriptions[ $block_name ] : '';
}

/**
 * Get Block Icon
 */
function oneclick_siteforge_get_block_icon( $block_name ) {
	$icons = array(
		'top-slides'         => 'format-image',
		'text-section'       => 'editor-paragraph',
		'content-grid'       => 'grid-view',
		'feature-section'    => 'columns',
		'links'              => 'buttons',
		'plans-availability' => 'layout',
		'form'               => 'feedback',
		'gallery'            => 'format-gallery',
		'image'              => 'format-image',
		'map'                => 'location-alt',
		'poi'                => 'location',
		'menu'               => 'menu',
		'accordion-section'  => 'list-view',
		'html-section'       => 'code',
	);

	return isset( $icons[ $block_name ] ) ? $icons[ $block_name ] : 'block-default';
}

/**
 * Register ACF Options Page
 */
function oneclick_siteforge_register_options_page() {
	if ( function_exists( 'acf_add_options_page' ) ) {
		acf_add_options_page(
			array(
				'page_title' => 'oneClick Theme Settings',
				'menu_title' => 'Theme Settings',
				'menu_slug'  => 'oneclick-theme-settings',
				'capability' => 'manage_options',
				'redirect'   => false,
			)
		);
	}
}
add_action( 'acf/init', 'oneclick_siteforge_register_options_page' );

/**
 * Register Theme Options Fields
 */
function oneclick_siteforge_register_theme_fields() {
	if ( function_exists( 'acf_add_local_field_group' ) ) {
		acf_add_local_field_group(
			array(
				'key'      => 'group_oneclick_theme_settings',
				'title'    => 'Theme Settings',
				'fields'   => array(
					array(
						'key'   => 'field_property_name',
						'label' => 'Property Name',
						'name'  => 'property_name',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_property_address',
						'label' => 'Property Address',
						'name'  => 'property_address',
						'type'  => 'textarea',
					),
					array(
						'key'   => 'field_property_latitude',
						'label' => 'Property Latitude',
						'name'  => 'property_latitude',
						'type'  => 'number',
						'step'  => '0.000001',
					),
					array(
						'key'   => 'field_property_longitude',
						'label' => 'Property Longitude',
						'name'  => 'property_longitude',
						'type'  => 'number',
						'step'  => '0.000001',
					),
					array(
						'key'   => 'field_property_phone',
						'label' => 'Property Phone',
						'name'  => 'property_phone',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_property_email',
						'label' => 'Property Email',
						'name'  => 'property_email',
						'type'  => 'email',
					),
					array(
						'key'   => 'field_google_maps_api_key',
						'label' => 'Google Maps API Key',
						'name'  => 'google_maps_api_key',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_lead_capture_endpoint',
						'label' => 'Lead Capture API Endpoint',
						'name'  => 'lead_capture_endpoint',
						'type'  => 'text',
						'instructions' => 'Full URL for form submissions (e.g., https://api.oneclickcommunities.com/leads)',
					),
					array(
						'key'           => 'field_lumaleasing_enabled',
						'label'         => 'Enable certified LumaLeasing widget',
						'name'          => 'lumaleasing_enabled',
						'type'          => 'true_false',
						'default_value' => 0,
					),
					array(
						'key'          => 'field_lumaleasing_api_key',
						'label'        => 'LumaLeasing public API key',
						'name'         => 'lumaleasing_api_key',
						'type'         => 'text',
						'instructions' => 'Property-scoped public widget key issued by P11.',
					),
					array(
						'key'           => 'field_lumaleasing_api_base_url',
						'label'         => 'LumaLeasing API base URL',
						'name'          => 'lumaleasing_api_base_url',
						'type'          => 'url',
						'default_value' => 'https://hellop11.com',
					),
					array(
						'key'   => 'field_yardi_api_url',
						'label' => 'Yardi API URL',
						'name'  => 'yardi_api_url',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_rentcafe_api_url',
						'label' => 'RentCafe API URL',
						'name'  => 'rentcafe_api_url',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_social_facebook',
						'label' => 'Facebook URL',
						'name'  => 'social_facebook',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_social_instagram',
						'label' => 'Instagram URL',
						'name'  => 'social_instagram',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_social_twitter',
						'label' => 'Twitter URL',
						'name'  => 'social_twitter',
						'type'  => 'text',
					),
					array(
						'key'   => 'field_social_linkedin',
						'label' => 'LinkedIn URL',
						'name'  => 'social_linkedin',
						'type'  => 'text',
					),
				),
				'location' => array(
					array(
						array(
							'param'    => 'options_page',
							'operator' => '==',
							'value'    => 'oneclick-theme-settings',
						),
					),
				),
			)
		);
	}
}
add_action( 'acf/init', 'oneclick_siteforge_register_theme_fields' );

/**
 * Resolve the certified public widget/conversion configuration.
 */
function oneclick_siteforge_lumaleasing_configuration() {
	$certified = get_option( 'oneclick_siteforge_lumaleasing', array() );
	$certified = is_array( $certified ) ? $certified : array();
	$api_base = esc_url_raw( $certified['apiBaseUrl'] ?? oneclick_get_field( 'lumaleasing_api_base_url', 'https://hellop11.com' ) );

	return array(
		'enabled'            => isset( $certified['enabled'] ) ? (bool) $certified['enabled'] : (bool) oneclick_get_field( 'lumaleasing_enabled', false ),
		'apiKey'             => sanitize_text_field( $certified['apiKey'] ?? oneclick_get_field( 'lumaleasing_api_key' ) ),
		'apiBaseUrl'         => untrailingslashit( $api_base ),
		'websiteId'         => sanitize_text_field( $certified['websiteId'] ?? '' ),
		'conversionEndpoint'=> esc_url_raw( $certified['conversionEndpoint'] ?? oneclick_get_field( 'lead_capture_endpoint' ) ),
		'conversionKey'     => sanitize_text_field( $certified['conversionKey'] ?? '' ),
		'telemetryEndpoint' => esc_url_raw( $certified['telemetryEndpoint'] ?? '' ),
	);
}

/**
 * Register the immutable floor-plan row contract used by generated pages.
 */
function oneclick_siteforge_register_floor_plan_fields() {
	if ( ! function_exists( 'acf_add_local_field_group' ) ) {
		return;
	}

	$sub_fields = array();
	$field_types = array(
		'id' => 'text', 'name' => 'text', 'bedrooms' => 'number', 'bathrooms' => 'number',
		'sqft_min' => 'number', 'sqft_max' => 'number', 'rent_min' => 'number', 'rent_max' => 'number',
		'available_count' => 'number', 'specials' => 'textarea', 'image_url' => 'url',
		'image_alt' => 'text', 'availability_url' => 'url', 'apply_url' => 'url',
	);
	foreach ( $field_types as $name => $type ) {
		$sub_fields[] = array(
			'key'   => 'field_siteforge_floor_plan_' . $name,
			'label' => ucwords( str_replace( '_', ' ', $name ) ),
			'name'  => $name,
			'type'  => $type,
		);
	}

	acf_add_local_field_group(
		array(
			'key'    => 'group_siteforge_floor_plan_inventory',
			'title'  => 'SiteForge Floor Plan Inventory',
			'fields' => array(
				array(
					'key'        => 'field_siteforge_floor_plans',
					'label'      => 'Floor Plans',
					'name'       => 'floor_plans',
					'type'       => 'repeater',
					'layout'     => 'block',
					'sub_fields' => $sub_fields,
				),
			),
			'location' => array(
				array(
					array(
						'param'    => 'block',
						'operator' => '==',
						'value'    => 'acf/plans-availability',
					),
				),
			),
		)
	);
}
add_action( 'acf/init', 'oneclick_siteforge_register_floor_plan_fields' );

/**
 * Helper: Get field with fallback
 */
function oneclick_get_field( $field_name, $empty_value = '' ) {
	$value = get_field( $field_name, 'option' );
	return $value ? $value : $empty_value;
}

/**
 * Sanitize HTML for output
 */
function oneclick_sanitize_html( $html ) {
	return wp_kses_post( $html );
}

/**
 * Custom Template Tags
 */
require_once ONECLICK_SITEFORGE_DIR . '/inc/template-tags.php';

/**
 * Block Utilities
 */
require_once ONECLICK_SITEFORGE_DIR . '/inc/block-utilities.php';

/**
 * SiteForge REST API (capability discovery for the generation pipeline)
 */
require_once ONECLICK_SITEFORGE_DIR . '/inc/rest-api.php';
