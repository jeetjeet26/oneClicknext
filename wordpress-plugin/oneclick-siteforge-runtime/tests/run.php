<?php
/**
 * Focused dependency-free contract tests.
 */

require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-validation.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-assets.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-state.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-validation.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-assets.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-materializer.php';
require_once dirname( __DIR__ ) . '/includes/class-siteforge-runtime-v3-transactions.php';

if ( ! defined( 'ONECLICK_SITEFORGE_RUNTIME_V3_VERSION' ) ) {
	define( 'ONECLICK_SITEFORGE_RUNTIME_V3_VERSION', '3.0.0' );
}
if ( ! defined( 'ARRAY_A' ) ) {
	define( 'ARRAY_A', 'ARRAY_A' );
	define( 'OBJECT', 'OBJECT' );
	define( 'HOUR_IN_SECONDS', 3600 );
}

$siteforge_test_options       = array();
$siteforge_test_fail_resource = null;
$siteforge_test_posts         = array();
$siteforge_test_post_meta     = array();
$siteforge_test_theme_mods    = array();
$siteforge_test_menus         = array();
$siteforge_test_next_post_id  = 1000;
$siteforge_test_next_menu_id  = 2000;
$siteforge_test_stylesheet     = 'oneclick-siteforge-overlay-141414141414';
$siteforge_test_template       = 'oneclick-siteforge';

function get_option( $name, $default = false ) {
	global $siteforge_test_options;
	return array_key_exists( $name, $siteforge_test_options ) ? $siteforge_test_options[ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	global $siteforge_test_options;
	$changed = ! array_key_exists( $name, $siteforge_test_options ) || $siteforge_test_options[ $name ] !== $value;
	$siteforge_test_options[ $name ] = $value;
	return $changed;
}

function wp_cache_delete( $key, $group = '' ) {
	return true;
}

function clean_post_cache( $post_id ) {
	return null;
}

function add_option( $name, $value, $deprecated = '', $autoload = null ) {
	global $siteforge_test_options;
	if ( array_key_exists( $name, $siteforge_test_options ) ) {
		return false;
	}
	$siteforge_test_options[ $name ] = $value;
	return true;
}

function delete_option( $name ) {
	global $siteforge_test_options;
	$existed = array_key_exists( $name, $siteforge_test_options );
	unset( $siteforge_test_options[ $name ] );
	return $existed;
}

function apply_filters( $hook, $accepted, $resource_name = null ) {
	global $siteforge_test_fail_resource;
	if ( 'oneclick_siteforge_runtime_v3_resource_applied' === $hook && $resource_name === $siteforge_test_fail_resource ) {
		return false;
	}
	return $accepted;
}

function absint( $value ) {
	return abs( (int) $value );
}

function sanitize_html_class( $value ) {
	return preg_replace( '/[^A-Za-z0-9_-]/', '-', (string) $value );
}

function wp_slash( $value ) {
	return $value;
}

function wp_json_encode( $value, $flags = 0 ) {
	return json_encode( $value, $flags );
}

function is_wp_error( $value ) {
	return false;
}

function maybe_unserialize( $value ) {
	return $value;
}

function wp_generate_uuid4() {
	static $counter = 1;
	return sprintf( '00000000-0000-4000-8000-%012d', $counter++ );
}

function get_theme_mod( $name, $default = false ) {
	global $siteforge_test_theme_mods;
	return array_key_exists( $name, $siteforge_test_theme_mods ) ? $siteforge_test_theme_mods[ $name ] : $default;
}

function set_theme_mod( $name, $value ) {
	global $siteforge_test_theme_mods;
	$siteforge_test_theme_mods[ $name ] = $value;
}

function remove_theme_mod( $name ) {
	global $siteforge_test_theme_mods;
	unset( $siteforge_test_theme_mods[ $name ] );
}

function get_stylesheet() {
	global $siteforge_test_stylesheet;
	return $siteforge_test_stylesheet;
}

function get_template() {
	global $siteforge_test_template;
	return $siteforge_test_template;
}

function switch_theme( $stylesheet ) {
	global $siteforge_test_stylesheet, $siteforge_test_template;
	$siteforge_test_stylesheet = $stylesheet;
	$siteforge_test_template   = 0 === strpos( $stylesheet, 'oneclick-siteforge-overlay-' )
		? 'oneclick-siteforge'
		: $stylesheet;
}

function do_action( $hook ) {
	return null;
}

function wp_styles() {
	$styles = new stdClass();
	$styles->queue = array( 'siteforge-overlay-theme' );
	$styles->registered = array(
		'siteforge-overlay-theme' => (object) array(
			'src' => '/wp-content/themes/' . get_stylesheet() . '/style.css',
		),
	);
	return $styles;
}

function get_post( $post_id, $output = OBJECT ) {
	global $siteforge_test_posts;
	if ( ! isset( $siteforge_test_posts[ $post_id ] ) ) {
		return null;
	}
	return ARRAY_A === $output ? $siteforge_test_posts[ $post_id ] : (object) $siteforge_test_posts[ $post_id ];
}

function get_post_status( $post_id ) {
	$post = get_post( $post_id, ARRAY_A );
	return $post ? $post['post_status'] : false;
}

function get_page_template_slug( $post_id ) {
	$post = get_post( $post_id, ARRAY_A );
	return $post && isset( $post['page_template'] ) ? $post['page_template'] : '';
}

function wp_insert_post( $postarr, $wp_error = false ) {
	global $siteforge_test_posts, $siteforge_test_next_post_id;
	$post_id = isset( $postarr['ID'] ) ? absint( $postarr['ID'] ) : ++$siteforge_test_next_post_id;
	$current = isset( $siteforge_test_posts[ $post_id ] ) ? $siteforge_test_posts[ $post_id ] : array();
	$defaults = array(
		'ID' => $post_id, 'post_type' => 'page', 'post_title' => '', 'post_name' => '',
		'post_content' => '', 'post_excerpt' => '', 'post_status' => 'draft',
		'menu_order' => 0, 'page_template' => '',
	);
	$siteforge_test_posts[ $post_id ] = array_merge( $defaults, $current, $postarr, array( 'ID' => $post_id ) );
	return $post_id;
}

function wp_update_post( $postarr, $wp_error = false ) {
	return wp_insert_post( $postarr, $wp_error );
}

function wp_trash_post( $post_id ) {
	global $siteforge_test_posts;
	if ( ! isset( $siteforge_test_posts[ $post_id ] ) ) {
		return false;
	}
	$siteforge_test_posts[ $post_id ]['post_status'] = 'trash';
	return (object) $siteforge_test_posts[ $post_id ];
}

function wp_untrash_post( $post_id ) {
	global $siteforge_test_posts;
	if ( ! isset( $siteforge_test_posts[ $post_id ] ) ) {
		return false;
	}
	$siteforge_test_posts[ $post_id ]['post_status'] = 'draft';
	return $post_id;
}

function wp_delete_post( $post_id, $force = false ) {
	global $siteforge_test_posts, $siteforge_test_post_meta, $siteforge_test_menus;
	foreach ( $siteforge_test_menus as &$menu ) {
		unset( $menu['items'][ $post_id ] );
	}
	unset( $menu );
	if ( ! isset( $siteforge_test_posts[ $post_id ] ) ) {
		return false;
	}
	$post = (object) $siteforge_test_posts[ $post_id ];
	unset( $siteforge_test_posts[ $post_id ], $siteforge_test_post_meta[ $post_id ] );
	return $post;
}

function get_page_by_path( $slug, $output = OBJECT, $post_type = 'page' ) {
	global $siteforge_test_posts;
	foreach ( $siteforge_test_posts as $post ) {
		if ( $post_type === $post['post_type'] && $slug === $post['post_name'] && 'trash' !== $post['post_status'] ) {
			return OBJECT === $output ? (object) $post : $post;
		}
	}
	return null;
}

function get_post_meta( $post_id, $key = '', $single = false ) {
	global $siteforge_test_post_meta;
	$meta = isset( $siteforge_test_post_meta[ $post_id ] ) ? $siteforge_test_post_meta[ $post_id ] : array();
	if ( '' === $key ) {
		$output = array();
		foreach ( $meta as $meta_key => $value ) {
			$output[ $meta_key ] = array( $value );
		}
		return $output;
	}
	if ( ! array_key_exists( $key, $meta ) ) {
		return $single ? '' : array();
	}
	return $single ? $meta[ $key ] : array( $meta[ $key ] );
}

function update_post_meta( $post_id, $key, $value ) {
	global $siteforge_test_post_meta;
	$siteforge_test_post_meta[ $post_id ][ $key ] = $value;
	return true;
}

function add_post_meta( $post_id, $key, $value ) {
	return update_post_meta( $post_id, $key, $value );
}

function delete_post_meta( $post_id, $key ) {
	global $siteforge_test_post_meta;
	unset( $siteforge_test_post_meta[ $post_id ][ $key ] );
	return true;
}

class WP_Query {
	public $posts = array();

	public function __construct( $args ) {
		global $siteforge_test_posts;
		foreach ( $siteforge_test_posts as $post_id => $post ) {
			if ( isset( $args['post_type'] ) && $post['post_type'] !== $args['post_type'] ) {
				continue;
			}
			if ( isset( $args['post_status'] ) && ! in_array( $post['post_status'], (array) $args['post_status'], true ) ) {
				continue;
			}
			if ( isset( $args['meta_key'] ) && (string) get_post_meta( $post_id, $args['meta_key'], true ) !== (string) ( $args['meta_value'] ?? get_post_meta( $post_id, $args['meta_key'], true ) ) ) {
				continue;
			}
			if ( isset( $args['meta_key'] ) && '' === (string) get_post_meta( $post_id, $args['meta_key'], true ) ) {
				continue;
			}
			if ( isset( $args['meta_query'] ) ) {
				$matched = true;
				foreach ( $args['meta_query'] as $condition ) {
					if ( ! is_array( $condition ) || ! isset( $condition['key'] ) ) {
						continue;
					}
					if ( (string) get_post_meta( $post_id, $condition['key'], true ) !== (string) $condition['value'] ) {
						$matched = false;
					}
				}
				if ( ! $matched ) {
					continue;
				}
			}
			$this->posts[] = absint( $post_id );
		}
		if ( isset( $args['posts_per_page'] ) && $args['posts_per_page'] > 0 ) {
			$this->posts = array_slice( $this->posts, 0, $args['posts_per_page'] );
		}
	}
}

function wp_get_nav_menu_object( $name ) {
	global $siteforge_test_menus;
	foreach ( $siteforge_test_menus as $menu ) {
		if ( (string) $name === (string) $menu['name'] || absint( $name ) === absint( $menu['term_id'] ) ) {
			return (object) $menu;
		}
	}
	return false;
}

function wp_create_nav_menu( $name ) {
	global $siteforge_test_menus, $siteforge_test_next_menu_id;
	$menu_id = ++$siteforge_test_next_menu_id;
	$siteforge_test_menus[ $menu_id ] = array( 'term_id' => $menu_id, 'name' => $name, 'items' => array() );
	return $menu_id;
}

function wp_get_nav_menu_items( $menu_id, $args = array() ) {
	global $siteforge_test_menus;
	if ( ! isset( $siteforge_test_menus[ $menu_id ] ) ) {
		return false;
	}
	$items = array_values( $siteforge_test_menus[ $menu_id ]['items'] );
	usort( $items, static function ( $left, $right ) { return $left->menu_order <=> $right->menu_order; } );
	return $items;
}

function wp_update_nav_menu_item( $menu_id, $item_id, $args ) {
	global $siteforge_test_menus, $siteforge_test_posts, $siteforge_test_next_post_id;
	$item_id = $item_id ? absint( $item_id ) : ++$siteforge_test_next_post_id;
	$item = (object) array(
		'ID' => $item_id,
		'title' => $args['menu-item-title'] ?? '',
		'url' => $args['menu-item-url'] ?? '',
		'object_id' => absint( $args['menu-item-object-id'] ?? 0 ),
		'object' => $args['menu-item-object'] ?? '',
		'type' => $args['menu-item-type'] ?? 'custom',
		'post_status' => 'publish',
		'menu_order' => absint( $args['menu-item-position'] ?? 0 ),
		'menu_item_parent' => absint( $args['menu-item-parent-id'] ?? 0 ),
		'target' => $args['menu-item-target'] ?? '',
		'classes' => array(),
	);
	$siteforge_test_menus[ $menu_id ]['items'][ $item_id ] = $item;
	$siteforge_test_posts[ $item_id ] = array(
		'ID' => $item_id, 'post_type' => 'nav_menu_item', 'post_title' => $item->title,
		'post_name' => '', 'post_content' => '', 'post_excerpt' => '', 'post_status' => 'publish',
		'menu_order' => $item->menu_order, 'page_template' => '',
	);
	return $item_id;
}

function wp_delete_nav_menu( $menu_id ) {
	global $siteforge_test_menus;
	unset( $siteforge_test_menus[ $menu_id ] );
	return true;
}

$failures = 0;

function siteforge_test( $name, $callback ) {
	global $failures;
	try {
		$callback();
		fwrite( STDOUT, "PASS {$name}\n" );
	} catch ( Throwable $error ) {
		++$failures;
		fwrite( STDERR, "FAIL {$name}: {$error->getMessage()}\n" );
	}
}

function siteforge_fixture( $name ) {
	$path = dirname( __DIR__ ) . '/fixtures/v2/' . $name . '.json';
	$data = json_decode( file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) {
		throw new RuntimeException( 'Could not decode fixture ' . $name );
	}
	return $data;
}

function siteforge_v3_fixture( $name ) {
	$path = dirname( __DIR__ ) . '/fixtures/v3/' . $name . '.json';
	$data = json_decode( file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) {
		throw new RuntimeException( 'Could not decode v3 fixture ' . $name );
	}
	return $data;
}

function siteforge_assert( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

function siteforge_v3_reset_options() {
	global $siteforge_test_options, $siteforge_test_fail_resource, $siteforge_test_posts,
		$siteforge_test_post_meta, $siteforge_test_theme_mods, $siteforge_test_menus,
		$siteforge_test_next_post_id, $siteforge_test_next_menu_id,
		$siteforge_test_stylesheet, $siteforge_test_template;
	$siteforge_test_options       = array();
	$siteforge_test_fail_resource = null;
	$siteforge_test_posts         = array();
	$siteforge_test_post_meta     = array();
	$siteforge_test_theme_mods    = array();
	$siteforge_test_menus         = array();
	$siteforge_test_next_post_id  = 1000;
	$siteforge_test_next_menu_id  = 2000;
	$siteforge_test_stylesheet     = 'oneclick-siteforge-overlay-141414141414';
	$siteforge_test_template       = 'oneclick-siteforge';
}

function siteforge_v3_transactions() {
	$state        = new SiteForge_Runtime_V3_State();
	$assets       = new SiteForge_Runtime_V3_Assets( new SiteForge_Runtime_Assets() );
	$materializer = new SiteForge_Runtime_V3_Materializer( $assets );
	return array( $state, new SiteForge_Runtime_V3_Transactions( $state, $assets, $materializer ) );
}

class SiteForge_Test_Failing_Restore_Materializer extends SiteForge_Runtime_V3_Materializer {
	public $remaining_restore_failures = 1;

	public function restore( $snapshot ) {
		if ( $this->remaining_restore_failures > 0 ) {
			--$this->remaining_restore_failures;
			throw new SiteForge_Runtime_Exception( 'siteforge_test_rollback_failed', 'Injected rollback failure.', 500 );
		}
		parent::restore( $snapshot );
	}
}

function siteforge_v3_release_with_navigation() {
	$release = siteforge_v3_fixture( 'release' );
	$release['resourceGraph']['globalComponents'][] = array(
		'resourceId' => 'component:navigation',
		'contentHash' => str_repeat( '5', 64 ),
		'componentType' => 'navigation',
		'data' => array(
			'name' => 'SiteForge Primary',
			'location' => 'primary',
			'items' => array(
				array(
					'itemId' => 'nav:home',
					'label' => 'Home',
					'pageId' => 'page:home',
					'parentItemId' => '',
					'target' => '_self',
				),
				array(
					'itemId' => 'nav:child',
					'label' => 'Child',
					'href' => '/child',
					'parentItemId' => 'nav:home',
					'target' => '_self',
				),
			),
		),
		'assetIds' => array(),
		'integrationIds' => array(),
	);
	$release['resourceGraph']['chrome']['componentIds'][] = 'component:navigation';
	$release['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $release['resourceGraph'] );
	return $release;
}

function siteforge_v3_asset_request( $release ) {
	$identity = $release['identity'];
	return array(
		'contractVersion' => 3,
		'identity'        => $identity,
		'idempotencyKey'  => SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 3,
				'scope'                     => 'asset_preparation',
				'identity'                  => $identity,
				'expectedRemoteContentHash' => null,
			)
		),
		'assets'          => array_map(
			static function ( $asset ) use ( $release ) {
				foreach ( $release['assetSources'] as $source ) {
					if ( $source['assetId'] === $asset['assetId'] ) {
						return array( 'asset' => $asset, 'source' => $source );
					}
				}
				throw new RuntimeException( 'Missing v3 fixture asset source.' );
			},
			$release['resourceGraph']['assets']
		),
	);
}

function siteforge_v3_store_preparation( $release, $preparation_id ) {
	$asset_request = siteforge_v3_asset_request( $release );
	$assets = array();
	foreach ( $release['resourceGraph']['assets'] as $index => $asset ) {
		$assets[] = array(
			'assetId'      => $asset['assetId'],
			'byteSha256'   => $asset['byteSha256'],
			'attachmentId' => 100 + $index,
			'url'          => 'https://wordpress.example.com/uploads/' . $asset['filename'],
			'mimeType'     => $asset['mimeType'],
			'disposition'  => 'reused',
		);
	}
	update_option(
		SiteForge_Runtime_V3_Assets::PREPARATIONS_OPTION,
		array(
			$preparation_id => array(
				'contractVersion' => 3,
				'preparationId'   => $preparation_id,
				'identity'        => $release['identity'],
				'idempotencyKey'  => $asset_request['idempotencyKey'],
				'assets'          => $assets,
				'preparedAt'      => '2026-08-04T20:01:00.000Z',
			),
		),
		false
	);
}

function siteforge_v3_deployment_request( $release, $preparation_id, $expected_hash ) {
	return array(
		'contractVersion'           => 3,
		'release'                   => $release,
		'assetPreparationId'        => $preparation_id,
		'expectedRemoteContentHash' => $expected_hash,
		'idempotencyKey'            => SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'           => 3,
				'scope'                     => 'deployment',
				'identity'                  => $release['identity'],
				'expectedRemoteContentHash' => $expected_hash,
			)
		),
	);
}

siteforge_test(
	'asset fixture validates canonical identities',
	static function () {
		$parsed = SiteForge_Runtime_Validation::asset_request( siteforge_fixture( 'asset-preparation-request' ) );
		siteforge_assert( 2 === $parsed['contractVersion'], 'Wrong contract version.' );
		siteforge_assert( 1 === count( $parsed['assets'] ), 'Asset was not retained.' );
		siteforge_assert(
			'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' === $parsed['assets'][0]['byteHash'],
			'Byte hash was not retained.'
		);
	}
);

siteforge_test(
	'asset byte identity tampering is rejected',
	static function () {
		$fixture = siteforge_fixture( 'asset-preparation-request' );
		$fixture['assets'][0]['bytes'] = 1235;
		try {
			SiteForge_Runtime_Validation::asset_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'siteforge_asset_manifest_hash_mismatch' === $error->get_siteforge_code(),
				'Wrong asset mismatch error.'
			);
			return;
		}
		throw new RuntimeException( 'Tampered asset identity was accepted.' );
	}
);

siteforge_test(
	'deployment fixture validates operation and plan hashes',
	static function () {
		$parsed = SiteForge_Runtime_Validation::deployment_request( siteforge_fixture( 'deployment-request' ) );
		siteforge_assert(
			'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' === $parsed['artifactContentHash'],
			'Artifact content hash was not retained.'
		);
		siteforge_assert( 1 === count( $parsed['plan']['pages'] ), 'Pages were not retained.' );
	}
);

siteforge_test(
	'strict optional runtime state and block capabilities validate',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$state   = siteforge_fixture( 'runtime-plan-state' );
		foreach ( $state as $key => $value ) {
			$fixture['plan'][ $key ] = $value;
		}
		$fixture['plan']['pages'][0]['sections'][0] = siteforge_fixture( 'runtime-parity-section' );
		$fixture['operationHash'] = SiteForge_Runtime_Validation::hash( $fixture['plan'] );
		$fixture['idempotencyKey'] = SiteForge_Runtime_Validation::hash(
			array(
				'contractVersion'          => 2,
				'scope'                    => 'deployment',
				'siteId'                   => $fixture['siteId'],
				'artifactId'               => $fixture['artifactId'],
				'artifactContentHash'      => $fixture['artifactContentHash'],
				'expectedRemoteContentHash'=> $fixture['expectedRemoteContentHash'],
				'payloadHash'              => $fixture['operationHash'],
			)
		);
		$parsed = SiteForge_Runtime_Validation::deployment_request( $fixture );
		siteforge_assert( 'password_noindex' === $parsed['plan']['protection']['mode'], 'Protection state was not retained.' );
		siteforge_assert( array( 'editorial-copy', 'theme-dark' ) === $parsed['plan']['pages'][0]['sections'][0]['cssClasses'], 'CSS classes were not retained.' );
		siteforge_assert( 'section:hero' === $parsed['plan']['pages'][0]['sections'][0]['anchor'], 'Section anchor was not retained.' );
		siteforge_assert( 'wide' === $parsed['plan']['pages'][0]['sections'][0]['align'], 'Block alignment was not retained.' );
	}
);

siteforge_test(
	'unsupported block variants reject before mutation',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['pages'][0]['sections'][0]['variant'] = 'invented-layout';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.pages[0].sections[0].variant' === $error->get_details()['path'],
				'Wrong unsupported-variant path.'
			);
			return;
		}
		throw new RuntimeException( 'Unsupported block variant was accepted.' );
	}
);

siteforge_test(
	'full site configuration rejects unknown state',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$state   = siteforge_fixture( 'runtime-plan-state' );
		foreach ( $state as $key => $value ) {
			$fixture['plan'][ $key ] = $value;
		}
		$fixture['plan']['siteConfiguration']['unexpected'] = true;
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.siteConfiguration.unexpected' === $error->get_details()['path'],
				'Wrong strict site-configuration path.'
			);
			return;
		}
		throw new RuntimeException( 'Unknown site-configuration state was accepted.' );
	}
);

siteforge_test(
	'SEO requires root-relative canonical paths and valid JSON-LD',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['pages'][0]['seo'] = array(
			'title'          => 'Home',
			'description'    => 'Welcome home',
			'canonicalPath'  => '/',
			'noIndex'        => false,
			'structuredData' => array( '{"@context":"https://schema.org","@type":"WebPage"}' ),
		);
		$fixture['plan']['pages'][0]['seo']['structuredData'][0] = 'not-json';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.pages[0].seo.structuredData[0]' === $error->get_details()['path'],
				'Wrong JSON-LD validation path.'
			);
			return;
		}
		throw new RuntimeException( 'Malformed JSON-LD was accepted.' );
	}
);

siteforge_test(
	'navigation cycles reject before mutation',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['navigation']['items'][0]['parentItemKey'] = 'nav:home';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'plan.navigation.items[0].parentItemKey' === $error->get_details()['path'],
				'Wrong navigation-cycle path.'
			);
			return;
		}
		throw new RuntimeException( 'Cyclic navigation was accepted.' );
	}
);

siteforge_test(
	'operation payload tampering is rejected',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['plan']['siteSettings']['siteName'] = 'Tampered';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert(
				'siteforge_operation_hash_mismatch' === $error->get_siteforge_code(),
				'Wrong operation mismatch error.'
			);
			return;
		}
		throw new RuntimeException( 'Tampered operation was accepted.' );
	}
);

siteforge_test(
	'string contract versions are rejected',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		$fixture['contractVersion'] = '2';
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'contractVersion' === $error->get_details()['path'], 'Wrong contract-version path.' );
			return;
		}
		throw new RuntimeException( 'String contractVersion was accepted.' );
	}
);

siteforge_test(
	'direct desired-state fields are required',
	static function () {
		$fixture = siteforge_fixture( 'deployment-request' );
		unset( $fixture['plan']['navigation'] );
		try {
			SiteForge_Runtime_Validation::deployment_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'plan.navigation' === $error->get_details()['path'], 'Wrong required-field path.' );
			return;
		}
		throw new RuntimeException( 'Incomplete desired-state plan was accepted.' );
	}
);

siteforge_test(
	'unknown contract fields are rejected',
	static function () {
		$fixture = siteforge_fixture( 'asset-preparation-request' );
		$fixture['legacyArtifactHash'] = str_repeat( 'a', 64 );
		try {
			SiteForge_Runtime_Validation::asset_request( $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'body.legacyArtifactHash' === $error->get_details()['path'], 'Wrong unknown-field path.' );
			return;
		}
		throw new RuntimeException( 'Unknown legacy field was accepted.' );
	}
);

foreach (
	array(
		'health'                  => 'health',
		'capabilities'            => 'capabilities',
		'asset-preparation-result'=> 'asset-preparation-result',
		'state'                   => 'state',
		'deployment-succeeded'    => 'deployment-status',
		'stale-remote-error'      => 'error',
	) as $fixture_name => $kind
) {
	siteforge_test(
		$fixture_name . ' shared response fixture validates',
		static function () use ( $fixture_name, $kind ) {
			$parsed = SiteForge_Runtime_Validation::response_fixture( $kind, siteforge_fixture( $fixture_name ) );
			siteforge_assert( 2 === $parsed['contractVersion'], 'Response fixture contractVersion is not integer 2.' );
		}
	);
}

siteforge_test(
	'response fixtures reject stale aliases',
	static function () {
		$fixture = siteforge_fixture( 'state' );
		$fixture['remoteContentHash'] = $fixture['artifactContentHash'];
		try {
			SiteForge_Runtime_Validation::response_fixture( 'state', $fixture );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'state.remoteContentHash' === $error->get_details()['path'], 'Wrong stale-alias path.' );
			return;
		}
		throw new RuntimeException( 'Stale response alias was accepted.' );
	}
);

siteforge_test(
	'v3 shared release and capabilities fixtures retain exact identities',
	static function () {
		$release      = SiteForge_Runtime_V3_Validation::release( siteforge_v3_fixture( 'release' ) );
		$capabilities = siteforge_v3_fixture( 'capabilities' );
		$empty_state  = siteforge_v3_fixture( 'empty-state' );
		$projection   = siteforge_v3_fixture( 'projection-v2' );
		siteforge_assert( 3 === $release['contractVersion'], 'V3 release contract version changed.' );
		foreach ( array( 'pages', 'sections', 'globalComponents', 'chrome', 'forms', 'redirects', 'responsiveRules', 'accessibilityAnnotations', 'seo', 'legal', 'analytics', 'integrations', 'assets', 'removals' ) as $resource_name ) {
			siteforge_assert( array_key_exists( $resource_name, $release['resourceGraph'] ), 'V3 resource graph fixture is missing ' . $resource_name . '.' );
		}
		siteforge_assert( 'runtime_plugin' === $release['identity']['runtimePackage']['packageType'], 'Runtime package identity was not retained.' );
		siteforge_assert( 3 === $capabilities['contractVersion'], 'V3 capabilities contract version changed.' );
		siteforge_assert( true === $capabilities['features']['completeResourceGraph'], 'V3 complete-resource capability changed.' );
		siteforge_assert( true === $capabilities['features']['exactPackageIdentity'], 'V3 package-identity capability changed.' );
		siteforge_assert( array_keys( $empty_state ) === array_keys( ( new SiteForge_Runtime_V3_State() )->empty_state( 'site-1' ) ), 'V3 empty-state endpoint shape changed.' );
		siteforge_assert( 3 === $projection['contractVersion'] && 2 === $projection['projection']['contractVersion'], 'V3 projection endpoint shape changed.' );
	}
);

siteforge_test(
	'v3 malformed and unknown fields fail closed before mutation',
	static function () {
		$unknown = siteforge_v3_fixture( 'release' );
		$unknown['resourceGraph']['pages'][0]['futureField'] = true;
		try {
			SiteForge_Runtime_V3_Validation::release( $unknown );
			throw new RuntimeException( 'V3 unknown field was accepted.' );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'release.resourceGraph.pages[0].futureField' === $error->get_details()['path'], 'Wrong v3 unknown-field path.' );
		}

		$missing = siteforge_v3_fixture( 'release' );
		$missing['resourceGraph']['pages'][0]['sectionIds'] = array( 'section:missing' );
		$missing['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $missing['resourceGraph'] );
		try {
			SiteForge_Runtime_V3_Validation::release( $missing );
			throw new RuntimeException( 'V3 missing resource reference was accepted.' );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'release.resourceGraph.pages[0].sectionIds' === $error->get_details()['path'], 'Wrong v3 graph-reference path.' );
		}

		$partial_assets = siteforge_v3_asset_request( siteforge_v3_fixture( 'release' ) );
		$partial_assets['assets'] = array();
		try {
			SiteForge_Runtime_V3_Validation::asset_request( $partial_assets );
			throw new RuntimeException( 'Partial v3 asset preparation was accepted.' );
		} catch ( SiteForge_Runtime_Validation_Exception $error ) {
			siteforge_assert( 'body.assets' === $error->get_details()['path'], 'Wrong v3 asset-manifest path.' );
		}
	}
);

siteforge_test(
	'v3 apply readback and strict v2 projection remain exact',
	static function () {
		siteforge_v3_reset_options();
		$release        = siteforge_v3_fixture( 'release' );
		$preparation_id = 'preparation:fixture-v3';
		siteforge_v3_store_preparation( $release, $preparation_id );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$status       = $transactions->apply( siteforge_v3_deployment_request( $release, $preparation_id, null ) );
		$readback     = $state->read( $release['identity']['siteId'] );
		$projection   = $state->projection();

		siteforge_assert( 'succeeded' === $status['status'] && 'complete' === $status['phase'], 'V3 deployment did not complete.' );
		siteforge_assert( true === $status['verification']['verified'], 'V3 deployment readback was not verified.' );
		siteforge_assert( $release['identity'] === $readback['identity'], 'V3 state lost exact release identities.' );
		siteforge_assert( 2 === $projection['contractVersion'], 'V3 state did not produce a v2 projection.' );
		siteforge_assert( $release['identity']['artifactContentHash'] === $projection['artifactContentHash'], 'V2 projection changed artifact identity.' );
		siteforge_assert( $release['identity']['operationSetHash'] === $projection['operationHash'], 'V2 projection changed operation identity.' );
	}
);

siteforge_test(
	'v3 projects complete site presentation motion and behavior options',
	static function () {
		siteforge_v3_reset_options();
		$release = siteforge_v3_fixture( 'release' );
		$configuration = array(
			'design' => array(
				'colors' => array( 'primary' => '#112233', 'secondary' => '#445566', 'accent' => '#778899', 'background' => '#ffffff', 'text' => '#111111' ),
				'typography' => array( 'headingFont' => 'Inter', 'bodyFont' => 'Inter', 'headingWeight' => 700 ),
				'spacing' => array( 'containerMaxWidth' => '1280px', 'sectionPadding' => '5rem' ),
			),
			'header' => array( 'layout' => 'logo-left', 'position' => 'sticky', 'announcement' => array( 'enabled' => false, 'text' => '' ), 'cta' => array( 'enabled' => true, 'label' => 'Visit', 'href' => '/visit/' ) ),
			'navigation' => array( 'style' => 'horizontal', 'items' => array() ),
			'footer' => array( 'layout' => 'columns', 'showNavigation' => true, 'showContact' => true, 'showSocial' => false ),
			'media' => array( 'imageTreatment' => 'editorial' ),
			'motion' => array( 'level' => 'subtle', 'reducedMotion' => 'respect', 'reveal' => 'fade', 'durationMs' => 240, 'easing' => 'ease-out' ),
			'behavior' => array( 'smoothScroll' => true, 'externalLinksNewTab' => false, 'backToTop' => true, 'cookieConsent' => 'required' ),
		);
		$configuration_resource = array(
			'resourceId' => 'component:site-configuration',
			'componentType' => 'utility',
			'data' => $configuration,
			'assetIds' => array(),
			'integrationIds' => array(),
		);
		$configuration_resource['contentHash'] = SiteForge_Runtime_Validation::hash( $configuration_resource );
		$release['resourceGraph']['globalComponents'][] = $configuration_resource;
		$release['resourceGraph']['chrome']['componentIds'][] = $configuration_resource['resourceId'];
		$chrome_without_hash = $release['resourceGraph']['chrome'];
		unset( $chrome_without_hash['contentHash'] );
		$release['resourceGraph']['chrome']['contentHash'] = SiteForge_Runtime_Validation::hash( $chrome_without_hash );
		$release['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $release['resourceGraph'] );
		$release['operations'][0]['resourceHash'] = $release['resourceGraph']['chrome']['contentHash'];
		$release['operations'][0]['payloadHash'] = $release['identity']['resourceGraphHash'];
		$release['identity']['operationSetHash'] = SiteForge_Runtime_Validation::hash( $release['operations'] );

		siteforge_v3_store_preparation( $release, 'preparation:configuration-v3' );
		list( , $transactions ) = siteforge_v3_transactions();
		$status = $transactions->apply( siteforge_v3_deployment_request( $release, 'preparation:configuration-v3', null ) );

		siteforge_assert( 'succeeded' === $status['status'], 'V3 configuration projection did not complete.' );
		siteforge_assert( $configuration['behavior'] === get_option( 'oneclick_siteforge_configuration' )['behavior'], 'Behavior projection changed.' );
		siteforge_assert( $configuration['motion'] === get_option( 'oneclick_siteforge_motion' ), 'Motion projection changed.' );
		siteforge_assert( $configuration['design']['colors'] === get_option( 'oneclick_siteforge_design_tokens' )['colors'], 'Design token projection changed.' );
	}
);

siteforge_test(
	'v3 failed apply performs compensating rollback to verified state',
	static function () {
		global $siteforge_test_fail_resource;
		siteforge_v3_reset_options();
		list( $state, $transactions ) = siteforge_v3_transactions();
		$first        = siteforge_v3_fixture( 'release' );
		siteforge_v3_store_preparation( $first, 'preparation:first-v3' );
		$transactions->apply( siteforge_v3_deployment_request( $first, 'preparation:first-v3', null ) );

		$second = siteforge_v3_fixture( 'release' );
		$second['identity']['artifactId']          = '99999999-9999-4999-8999-999999999999';
		$second['identity']['artifactContentHash'] = str_repeat( 'e', 64 );
		$second['identity']['overlays'][0]['contentHash'] = str_repeat( '2', 64 );
		$second['identity']['overlays'][0]['themeSlug'] = 'oneclick-siteforge-overlay-222222222222';
		$second['resourceGraph']['pages'][0]['title'] = 'Candidate title';
		$second['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $second['resourceGraph'] );
		siteforge_v3_store_preparation( $second, 'preparation:second-v3' );
		update_option(
			SiteForge_Runtime_V3_Materializer::PENDING_THEME_OPTION,
			array(
				'stylesheet' => $first['identity']['overlays'][0]['themeSlug'],
				'template'   => 'oneclick-siteforge',
			),
			false
		);
		switch_theme( $second['identity']['overlays'][0]['themeSlug'] );
		$siteforge_test_fail_resource = 'sections';
		try {
			$transactions->apply(
				siteforge_v3_deployment_request(
					$second,
					'preparation:second-v3',
					$first['identity']['artifactContentHash']
				)
			);
			throw new RuntimeException( 'Injected v3 resource failure did not fail.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			$details = $error->get_details();
			siteforge_assert( true === $details['rollback']['succeeded'], 'V3 compensating rollback did not succeed.' );
		}
		$siteforge_test_fail_resource = null;
		$readback = $state->read( $first['identity']['siteId'] );
		siteforge_assert( $first['identity']['artifactContentHash'] === $readback['identity']['artifactContentHash'], 'Failed v3 candidate replaced active state.' );
		siteforge_assert( $first['identity']['overlays'][0]['themeSlug'] === get_stylesheet(), 'Failed v3 candidate did not restore the prior active child theme.' );
		siteforge_assert( true === $state->verify()['verified'], 'Compensated v3 state failed readback verification.' );
	}
);

siteforge_test(
	'v3 failed first attempt retries safely and preserves attempt evidence',
	static function () {
		global $siteforge_test_fail_resource;
		siteforge_v3_reset_options();
		$release        = siteforge_v3_fixture( 'release' );
		$preparation_id = 'preparation:retry-v3';
		siteforge_v3_store_preparation( $release, $preparation_id );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$request = siteforge_v3_deployment_request( $release, $preparation_id, null );

		$siteforge_test_fail_resource = 'sections';
		try {
			$transactions->apply( $request );
			throw new RuntimeException( 'Injected first-attempt failure did not fail.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( true === $error->get_details()['rollback']['succeeded'], 'First attempt did not recover before retry.' );
		}
		$siteforge_test_fail_resource = null;
		$retried = $transactions->apply( $request );
		$replay  = $transactions->apply( $request );

		$records  = get_option( SiteForge_Runtime_V3_Transactions::IDEMPOTENCY_OPTION, array() );
		$record   = reset( $records );
		$attempts = $record['attempts'];
		siteforge_assert( 'succeeded' === $retried['status'], 'Retry did not materialize successfully.' );
		siteforge_assert( $retried['transactionId'] === $replay['transactionId'], 'Successful terminal result was not replay-stable.' );
		siteforge_assert( true === $replay['idempotentReplay'], 'Successful replay was not identified.' );
		siteforge_assert( 2 === count( $attempts ), 'Retry attempt evidence was not retained.' );
		siteforge_assert( 'failed' === $attempts[0]['status'] && true === $attempts[0]['rollback']['succeeded'], 'Failed attempt evidence is incomplete.' );
		siteforge_assert( 'succeeded' === $attempts[1]['status'], 'Successful retry evidence is incomplete.' );
		siteforge_assert( $attempts[0]['transactionId'] !== $attempts[1]['transactionId'], 'Retry did not receive a distinct transaction identity.' );
		siteforge_assert( $release['identity']['artifactContentHash'] === $state->active_content_hash(), 'Retry did not commit the exact artifact identity.' );
	}
);

siteforge_test(
	'v3 concurrent deployment lock prevents a competing attempt',
	static function () {
		siteforge_v3_reset_options();
		$release        = siteforge_v3_fixture( 'release' );
		$preparation_id = 'preparation:locked-v3';
		siteforge_v3_store_preparation( $release, $preparation_id );
		update_option(
			SiteForge_Runtime_V3_Transactions::LOCK_OPTION,
			array( 'token' => 'competing-transaction', 'createdAt' => time() ),
			false
		);
		list( $state, $transactions ) = siteforge_v3_transactions();
		try {
			$transactions->apply( siteforge_v3_deployment_request( $release, $preparation_id, null ) );
			throw new RuntimeException( 'Competing transaction ignored the deployment lock.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( 'siteforge_v3_deployment_locked' === $error->get_siteforge_code(), 'Wrong concurrent lock failure.' );
		}
		siteforge_assert( array() === get_option( SiteForge_Runtime_V3_Transactions::IDEMPOTENCY_OPTION, array() ), 'Locked request poisoned its idempotency key.' );
		siteforge_assert( null === $state->active_content_hash(), 'Locked request mutated active state.' );
	}
);

siteforge_test(
	'v3 failed rollback is recovered before retry materialization',
	static function () {
		global $siteforge_test_fail_resource;
		siteforge_v3_reset_options();
		$release        = siteforge_v3_fixture( 'release' );
		$preparation_id = 'preparation:rollback-retry-v3';
		siteforge_v3_store_preparation( $release, $preparation_id );
		$state        = new SiteForge_Runtime_V3_State();
		$assets       = new SiteForge_Runtime_V3_Assets( new SiteForge_Runtime_Assets() );
		$materializer = new SiteForge_Test_Failing_Restore_Materializer( $assets );
		$transactions = new SiteForge_Runtime_V3_Transactions( $state, $assets, $materializer );
		$request      = siteforge_v3_deployment_request( $release, $preparation_id, null );

		$siteforge_test_fail_resource = 'sections';
		try {
			$transactions->apply( $request );
			throw new RuntimeException( 'Injected rollback failure did not fail.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( false === $error->get_details()['rollback']['succeeded'], 'Injected rollback failure was not recorded.' );
		}
		$siteforge_test_fail_resource = null;
		$retried = $transactions->apply( $request );
		$records = get_option( SiteForge_Runtime_V3_Transactions::IDEMPOTENCY_OPTION, array() );
		$record  = reset( $records );

		siteforge_assert( 'succeeded' === $retried['status'], 'Retry after rollback recovery did not succeed.' );
		siteforge_assert( 2 === count( $record['attempts'] ), 'Rollback recovery created incorrect attempt evidence.' );
		siteforge_assert( true === $record['attempts'][0]['rollback']['succeeded'], 'Prior failed rollback was not recovered before re-execution.' );
		siteforge_assert( 'succeeded' === $record['attempts'][1]['status'], 'Recovered retry did not reach a successful terminal result.' );
	}
);

siteforge_test(
	'v3 materializes owned pages and replays retries idempotently',
	static function () {
		global $siteforge_test_posts;
		siteforge_v3_reset_options();
		$release = siteforge_v3_fixture( 'release' );
		$legacy_id = wp_insert_post(
			array(
				'post_type' => 'page', 'post_title' => 'Legacy', 'post_name' => 'legacy',
				'post_content' => 'Legacy', 'post_status' => 'publish',
			),
			true
		);
		update_post_meta( $legacy_id, SiteForge_Runtime_V3_Materializer::PAGE_RESOURCE_META, 'page:legacy' );
		update_post_meta( $legacy_id, SiteForge_Runtime_V3_Materializer::PAGE_SITE_META, 'site-1' );
		update_post_meta( $legacy_id, SiteForge_Runtime_V3_Materializer::PAGE_HASH_META, $release['resourceGraph']['removals'][0]['priorContentHash'] );
		siteforge_v3_store_preparation( $release, 'preparation:idempotent-v3' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$request = siteforge_v3_deployment_request( $release, 'preparation:idempotent-v3', null );
		$first   = $transactions->apply( $request );
		$replay  = $transactions->apply( $request );

		siteforge_assert( $first['transactionId'] === $replay['transactionId'], 'Retry created a second transaction.' );
		siteforge_assert( true === $replay['idempotentReplay'], 'Retry was not marked idempotent.' );
		siteforge_assert( isset( $first['resourceIds']['page:home'] ), 'Materialized page ID was not returned.' );
		siteforge_assert( 'Home' === $siteforge_test_posts[ $first['resourceIds']['page:home'] ]['post_title'], 'Page title was not materialized.' );
		siteforge_assert( 'trash' === get_post_status( $legacy_id ), 'Exact owned page tombstone was not applied.' );
		$state->read( 'site-1' );
		siteforge_assert( true === $state->verify()['verified'], 'Materialized retry state did not verify.' );
	}
);

siteforge_test(
	'v3 updates the same owned page and preserves resource identity',
	static function () {
		global $siteforge_test_posts;
		siteforge_v3_reset_options();
		$first = siteforge_v3_fixture( 'release' );
		siteforge_v3_store_preparation( $first, 'preparation:update-first' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$created = $transactions->apply( siteforge_v3_deployment_request( $first, 'preparation:update-first', null ) );
		$page_id = $created['resourceIds']['page:home'];

		$second = siteforge_v3_fixture( 'release' );
		$second['identity']['artifactId'] = '77777777-7777-4777-8777-777777777777';
		$second['identity']['artifactContentHash'] = str_repeat( '7', 64 );
		$second['resourceGraph']['pages'][0]['title'] = 'Updated Home';
		$second['resourceGraph']['pages'][0]['contentHash'] = str_repeat( '6', 64 );
		$second['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $second['resourceGraph'] );
		siteforge_v3_store_preparation( $second, 'preparation:update-second' );
		$updated = $transactions->apply(
			siteforge_v3_deployment_request( $second, 'preparation:update-second', $first['identity']['artifactContentHash'] )
		);

		siteforge_assert( $page_id === $updated['resourceIds']['page:home'], 'Update replaced the owned page ID.' );
		siteforge_assert( 'Updated Home' === $siteforge_test_posts[ $page_id ]['post_title'], 'Update did not materialize the new title.' );
		siteforge_assert( $second['identity']['artifactContentHash'] === $state->active_content_hash(), 'Updated artifact identity was not committed.' );
	}
);

siteforge_test(
	'v3 refuses to adopt an unowned page slug',
	static function () {
		siteforge_v3_reset_options();
		wp_insert_post(
			array(
				'post_type' => 'page', 'post_title' => 'Human Home', 'post_name' => 'home',
				'post_content' => 'Do not overwrite', 'post_status' => 'publish',
			),
			true
		);
		$release = siteforge_v3_fixture( 'release' );
		siteforge_v3_store_preparation( $release, 'preparation:ownership' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		try {
			$transactions->apply( siteforge_v3_deployment_request( $release, 'preparation:ownership', null ) );
			throw new RuntimeException( 'Unowned slug was adopted.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( 'siteforge_v3_page_slug_conflict' === $error->get_siteforge_code(), 'Wrong ownership conflict.' );
			siteforge_assert( true === $error->get_details()['rollback']['succeeded'], 'Ownership conflict did not compensate cleanly.' );
		}
	}
);

siteforge_test(
	'v3 state readback detects WordPress object drift',
	static function () {
		global $siteforge_test_posts;
		siteforge_v3_reset_options();
		$release = siteforge_v3_fixture( 'release' );
		siteforge_v3_store_preparation( $release, 'preparation:drift' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$status = $transactions->apply( siteforge_v3_deployment_request( $release, 'preparation:drift', null ) );
		$siteforge_test_posts[ $status['resourceIds']['page:home'] ]['post_title'] = 'Out-of-band edit';
		try {
			$state->read( 'site-1' );
			throw new RuntimeException( 'WordPress object drift was not detected.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( 'siteforge_v3_remote_state_drift' === $error->get_siteforge_code(), 'Wrong readback drift error.' );
		}
	}
);

siteforge_test(
	'v3 menu rollback verifies replacement menu and item IDs semantically',
	static function () {
		global $siteforge_test_fail_resource, $siteforge_test_menus;
		siteforge_v3_reset_options();
		$first = siteforge_v3_release_with_navigation();
		siteforge_v3_store_preparation( $first, 'preparation:menu-first' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$deployed       = $transactions->apply( siteforge_v3_deployment_request( $first, 'preparation:menu-first', null ) );
		$original_menu  = $deployed['resourceIds']['component:navigation'];
		$original_items = array_keys( $siteforge_test_menus[ $original_menu ]['items'] );

		$second = siteforge_v3_fixture( 'release' );
		$second['identity']['artifactId']          = '66666666-6666-4666-8666-666666666666';
		$second['identity']['artifactContentHash'] = str_repeat( '6', 64 );
		$second['identity']['resourceGraphHash']   = SiteForge_Runtime_Validation::hash( $second['resourceGraph'] );
		siteforge_v3_store_preparation( $second, 'preparation:menu-second' );
		$siteforge_test_fail_resource = 'sections';
		try {
			$transactions->apply(
				siteforge_v3_deployment_request(
					$second,
					'preparation:menu-second',
					$first['identity']['artifactContentHash']
				)
			);
			throw new RuntimeException( 'Injected menu candidate failure did not fail.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( true === $error->get_details()['rollback']['succeeded'], 'Menu rollback readback did not succeed.' );
		}
		$siteforge_test_fail_resource = null;

		$owners        = get_option( SiteForge_Runtime_V3_Materializer::MENU_OWNERS_OPTION, array() );
		$restored_menu = $owners['component:navigation']['menuId'];
		$restored_items= array_keys( $siteforge_test_menus[ $restored_menu ]['items'] );
		siteforge_assert( $original_menu !== $restored_menu, 'Rollback did not exercise a replacement WordPress menu ID.' );
		siteforge_assert( $original_items !== $restored_items, 'Rollback did not exercise replacement menu-item IDs.' );
		siteforge_assert( $restored_menu === get_theme_mod( 'nav_menu_locations', array() )['primary'], 'Replacement menu ID was not restored to its location.' );
		siteforge_assert( $restored_menu === get_option( SiteForge_Runtime_V3_Materializer::RESOURCE_IDS_OPTION )['ids']['component:navigation'], 'Replacement menu resource identity was not repaired.' );
		siteforge_assert( true === $state->verify()['verified'], 'Restored menu with replacement IDs did not verify.' );
	}
);

siteforge_test(
	'v3 materializes navigation and runtime surface options',
	static function () {
		global $siteforge_test_menus;
		siteforge_v3_reset_options();
		$release = siteforge_v3_release_with_navigation();
		siteforge_v3_store_preparation( $release, 'preparation:navigation' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		$status = $transactions->apply( siteforge_v3_deployment_request( $release, 'preparation:navigation', null ) );
		$menu_id = $status['resourceIds']['component:navigation'];

		siteforge_assert( isset( $siteforge_test_menus[ $menu_id ] ), 'Navigation component did not create a WordPress menu.' );
		siteforge_assert( 2 === count( $siteforge_test_menus[ $menu_id ]['items'] ), 'Navigation items did not materialize.' );
		siteforge_assert( $release['resourceGraph']['forms'] === get_option( SiteForge_Runtime_V3_Materializer::FORMS_OPTION ), 'Form resources were not exact.' );
		siteforge_assert( $release['resourceGraph']['redirects'] === get_option( SiteForge_Runtime_V3_Materializer::REDIRECTS_OPTION ), 'Redirect resources were not exact.' );
		siteforge_assert( $release['resourceGraph']['legal'] === get_option( SiteForge_Runtime_V3_Materializer::LEGAL_OPTION ), 'Legal resources were not exact.' );
		siteforge_assert( true === $state->verify()['verified'], 'Navigation/runtime surface readback failed.' );
	}
);

siteforge_test(
	'v3 floor-plan resources fail closed without fresh inventory',
	static function () {
		global $siteforge_test_posts;
		siteforge_v3_reset_options();
		$release = siteforge_v3_fixture( 'release' );
		$release['resourceGraph']['sections'][0]['blockName'] = 'acf/plans-availability';
		$release['resourceGraph']['sections'][0]['data'] = array(
			'data_source' => 'siteforge',
			'floor_plans' => array(),
			'inventory_snapshot' => array(),
		);
		$release['resourceGraph']['sections'][0]['contentHash'] = str_repeat( '4', 64 );
		$release['identity']['resourceGraphHash'] = SiteForge_Runtime_Validation::hash( $release['resourceGraph'] );
		siteforge_v3_store_preparation( $release, 'preparation:inventory-unavailable' );
		list( $state, $transactions ) = siteforge_v3_transactions();
		try {
			$transactions->apply( siteforge_v3_deployment_request( $release, 'preparation:inventory-unavailable', null ) );
			throw new RuntimeException( 'Unavailable inventory was materialized.' );
		} catch ( SiteForge_Runtime_Exception $error ) {
			siteforge_assert( 'siteforge_v3_inventory_unavailable' === $error->get_siteforge_code(), 'Wrong inventory failure.' );
			siteforge_assert( true === $error->get_details()['rollback']['succeeded'], 'Inventory failure did not compensate.' );
			siteforge_assert( empty( $siteforge_test_posts ), 'Inventory failure mutated WordPress pages.' );
		}
	}
);

siteforge_test(
	'canonical hashing is independent of object key order',
	static function () {
		$left  = array( 'z' => 1, 'a' => array( 'y' => true, 'b' => 'value' ) );
		$right = array( 'a' => array( 'b' => 'value', 'y' => true ), 'z' => 1 );
		siteforge_assert(
			SiteForge_Runtime_Validation::hash( $left ) === SiteForge_Runtime_Validation::hash( $right ),
			'Canonical hashes differ.'
		);
	}
);

siteforge_test(
	'v1 compatibility fixtures remain readable',
	static function () {
		foreach ( array( 'deployment.json', 'asset-preparation.json' ) as $name ) {
			$path = __DIR__ . '/fixtures/' . $name;
			siteforge_assert( is_array( json_decode( file_get_contents( $path ), true ) ), 'Could not decode ' . $name );
		}
	}
);

siteforge_test(
	'runtime and theme source enforce parity safety invariants',
	static function () {
		$plugin_root = dirname( __DIR__ );
		$repo_root   = dirname( $plugin_root, 2 );
		$theme_root  = $repo_root . '/wordpress-theme/oneclick-siteforge';
		$transactions = file_get_contents( $plugin_root . '/includes/class-siteforge-runtime-transactions.php' );
		$assets       = file_get_contents( $plugin_root . '/includes/class-siteforge-runtime-assets.php' );
		$header       = file_get_contents( $theme_root . '/header.php' );
		$utilities    = file_get_contents( $theme_root . '/inc/block-utilities.php' );
		$behavior     = file_get_contents( $theme_root . '/assets/js/site-behavior.js' );
		$functions    = file_get_contents( $theme_root . '/functions.php' );

		siteforge_assert( false === strpos( $transactions, "get_page_by_path( 'sample-page'" ), 'Transactions still delete the unmanaged sample page.' );
		siteforge_assert( false !== strpos( $transactions, 'rollback_preparation' ), 'Asset rollback is not wired into transactions.' );
		siteforge_assert( false !== strpos( $assets, 'PREPARATION_EFFECTS_OPTION' ), 'Asset compensation effects are not tracked.' );
		siteforge_assert( false !== strpos( $transactions, 'SEO_TITLE_META' ), 'SiteForge SEO is not canonical in transactions.' );
		siteforge_assert( false !== strpos( $header, 'wp_nav_menu' ) && false !== strpos( $header, "'depth'          => 0" ), 'Header does not render the complete canonical WordPress menu.' );
		siteforge_assert( false === strpos( $utilities, "\$GLOBALS['block']" ), 'Block rendering still relies on a broken global.' );
		siteforge_assert( false !== strpos( $behavior, 'siteforge-back-to-top' ) && false !== strpos( $behavior, 'informational' ) && false !== strpos( $behavior, 'prefers-reduced-motion' ), 'Accepted behavior fields are not implemented.' );
		siteforge_assert( false !== strpos( $functions, '_siteforge_seo_title' ) && false !== strpos( $functions, 'wpseo_frontend_presenters' ), 'Theme SEO still depends on Yoast canonical storage.' );

		foreach ( glob( $theme_root . '/blocks/*.php' ) as $block_file ) {
			$source = file_get_contents( $block_file );
			if ( false !== strpos( $source, 'oneclick_get_block_wrapper_attributes(' ) ) {
				siteforge_assert( false !== strpos( $source, 'oneclick_get_block_wrapper_attributes( $block,' ), basename( $block_file ) . ' does not pass its local ACF block.' );
			}
		}
	}
);

if ( $failures > 0 ) {
	exit( 1 );
}

fwrite( STDOUT, "All SiteForge runtime contract tests passed.\n" );

