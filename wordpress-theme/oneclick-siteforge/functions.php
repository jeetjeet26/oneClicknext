<?php
/**
 * oneClick SiteForge Theme Functions
 *
 * @package OneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ONECLICK_SITEFORGE_VERSION', '1.0.0' );
define( 'ONECLICK_SITEFORGE_DIR', get_template_directory() );
define( 'ONECLICK_SITEFORGE_URI', get_template_directory_uri() );

/**
 * Theme Setup
 */
function oneclick_siteforge_setup() {
	load_theme_textdomain( 'oneclick-siteforge', ONECLICK_SITEFORGE_DIR . '/languages' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
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
		'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap',
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

	wp_enqueue_script(
		'oneclick-siteforge-mobile-menu',
		ONECLICK_SITEFORGE_URI . '/assets/js/mobile-menu.js',
		array(),
		ONECLICK_SITEFORGE_VERSION,
		true
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
