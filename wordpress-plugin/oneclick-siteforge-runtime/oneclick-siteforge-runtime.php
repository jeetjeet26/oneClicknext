<?php
/**
 * Plugin Name: oneClick SiteForge Runtime
 * Description: Applies immutable SiteForge releases to WordPress through authenticated, transactional REST endpoints.
 * Version: 2.0.1
 * Requires at least: 5.9
 * Requires PHP: 7.4
 * Author: oneClick Communities
 * License: GPL-2.0-or-later
 * Text Domain: oneclick-siteforge-runtime
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ONECLICK_SITEFORGE_RUNTIME_VERSION', '2.0.1' );
define( 'ONECLICK_SITEFORGE_RUNTIME_CONTRACT_VERSION', 2 );
define( 'ONECLICK_SITEFORGE_RUNTIME_V3_CONTRACT_VERSION', 3 );
define( 'ONECLICK_SITEFORGE_RUNTIME_V3_VERSION', '3.0.2' );
define( 'ONECLICK_SITEFORGE_RUNTIME_FILE', __FILE__ );
define( 'ONECLICK_SITEFORGE_RUNTIME_DIR', plugin_dir_path( __FILE__ ) );

require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-validation.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-assets.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-transactions.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-rest-controller.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-v3-state.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-v3-validation.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-v3-assets.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-v3-materializer.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-v3-transactions.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-v3-rest-controller.php';

/**
 * Register additive SiteForge v2 and v3 controllers from the permanent
 * runtime plugin. The theme's siteforge/v1 compatibility surface remains
 * independent and unchanged.
 */
function oneclick_siteforge_runtime_boot() {
	$assets       = new SiteForge_Runtime_Assets();
	$transactions = new SiteForge_Runtime_Transactions( $assets );
	$controller   = new SiteForge_Runtime_REST_Controller( $assets, $transactions );
	$v3_state        = new SiteForge_Runtime_V3_State();
	$v3_assets       = new SiteForge_Runtime_V3_Assets( $assets );
	$v3_materializer = new SiteForge_Runtime_V3_Materializer( $v3_assets );
	$v3_transactions = new SiteForge_Runtime_V3_Transactions( $v3_state, $v3_assets, $v3_materializer );
	$v3_controller   = new SiteForge_Runtime_V3_REST_Controller( $v3_state, $v3_transactions, $v3_assets );

	add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
	add_action( 'rest_api_init', array( $v3_controller, 'register_routes' ) );
}
add_action( 'plugins_loaded', 'oneclick_siteforge_runtime_boot' );

/**
 * Apply exact v3 redirect resources before WordPress selects a template.
 */
function oneclick_siteforge_runtime_v3_redirect() {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return;
	}
	$redirects = get_option( SiteForge_Runtime_V3_Materializer::REDIRECTS_OPTION, array() );
	if ( ! is_array( $redirects ) ) {
		return;
	}
	$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
	$request_url = wp_parse_url( $request_uri );
	$path        = isset( $request_url['path'] ) ? $request_url['path'] : '/';
	foreach ( $redirects as $redirect ) {
		if ( ! is_array( $redirect ) || $path !== $redirect['sourcePath'] ) {
			continue;
		}
		$destination = $redirect['destination'];
		if ( ! empty( $redirect['preserveQuery'] ) && ! empty( $request_url['query'] ) ) {
			$destination .= ( false === strpos( $destination, '?' ) ? '?' : '&' ) . $request_url['query'];
		}
		wp_redirect( $destination, (int) $redirect['statusCode'], 'oneClick SiteForge Runtime v3' );
		exit;
	}
}
add_action( 'template_redirect', 'oneclick_siteforge_runtime_v3_redirect', 0 );

