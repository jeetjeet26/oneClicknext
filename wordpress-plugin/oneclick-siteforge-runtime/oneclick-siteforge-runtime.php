<?php
/**
 * Plugin Name: oneClick SiteForge Runtime
 * Description: Applies immutable SiteForge releases to WordPress through authenticated, transactional REST endpoints.
 * Version: 2.0.0
 * Requires at least: 5.9
 * Requires PHP: 7.4
 * Author: oneClick Communities
 * License: GPL-2.0-or-later
 * Text Domain: oneclick-siteforge-runtime
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ONECLICK_SITEFORGE_RUNTIME_VERSION', '2.0.0' );
define( 'ONECLICK_SITEFORGE_RUNTIME_CONTRACT_VERSION', 2 );
define( 'ONECLICK_SITEFORGE_RUNTIME_FILE', __FILE__ );
define( 'ONECLICK_SITEFORGE_RUNTIME_DIR', plugin_dir_path( __FILE__ ) );

require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-validation.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-assets.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-transactions.php';
require_once ONECLICK_SITEFORGE_RUNTIME_DIR . 'includes/class-siteforge-runtime-rest-controller.php';

/**
 * Register SiteForge v2 only from the permanent runtime plugin. The theme's
 * siteforge/v1 routes remain an independent compatibility surface.
 */
function oneclick_siteforge_runtime_boot() {
	$assets       = new SiteForge_Runtime_Assets();
	$transactions = new SiteForge_Runtime_Transactions( $assets );
	$controller   = new SiteForge_Runtime_REST_Controller( $assets, $transactions );

	add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
}
add_action( 'plugins_loaded', 'oneclick_siteforge_runtime_boot' );

