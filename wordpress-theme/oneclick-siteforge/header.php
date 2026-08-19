<?php
/**
 * The header for our theme
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$siteforge_configuration = get_option( 'oneclick_siteforge_configuration', array() );
$siteforge_header = is_array( $siteforge_configuration['header'] ?? null ) ? $siteforge_configuration['header'] : array();
$siteforge_media = is_array( $siteforge_configuration['media'] ?? null ) ? $siteforge_configuration['media'] : array();
$siteforge_motion = is_array( $siteforge_configuration['motion'] ?? null ) ? $siteforge_configuration['motion'] : array();
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php wp_head(); ?>
</head>

<body <?php body_class(); ?> data-motion-level="<?php echo esc_attr( $siteforge_motion['level'] ?? 'none' ); ?>" data-motion-reveal="<?php echo esc_attr( $siteforge_motion['reveal'] ?? 'none' ); ?>" data-motion-reduced="<?php echo esc_attr( $siteforge_motion['reducedMotion'] ?? 'respect' ); ?>">
	<?php wp_body_open(); ?>

	<div id="page" class="site">
		<a class="skip-link screen-reader-text" href="#primary">
			<?php esc_html_e( 'Skip to content', 'oneclick-siteforge' ); ?>
		</a>

		<?php if ( ! empty( $siteforge_header['announcement']['enabled'] ) && ! empty( $siteforge_header['announcement']['text'] ) ) { ?>
			<div class="site-announcement">
				<span><?php echo esc_html( $siteforge_header['announcement']['text'] ); ?></span>
				<?php if ( ! empty( $siteforge_header['announcement']['link'] ) ) { ?>
					<a href="<?php echo esc_url( $siteforge_header['announcement']['link'] ); ?>"><?php esc_html_e( 'Learn more', 'oneclick-siteforge' ); ?></a>
				<?php } ?>
			</div>
		<?php } ?>

		<header id="masthead" class="site-header" data-layout="<?php echo esc_attr( $siteforge_header['layout'] ?? 'logo-left' ); ?>" data-position="<?php echo esc_attr( $siteforge_header['position'] ?? 'sticky' ); ?>" data-siteforge-resource="component:header" data-siteforge-target-id="header:component:header" data-siteforge-target-kind="header" data-siteforge-resource-path="<?php echo esc_attr( wp_json_encode( array( array( 'kind' => 'header', 'id' => 'component:header' ) ), JSON_UNESCAPED_SLASHES ) ); ?>" data-siteforge-display-value="Site header">
			<div class="site-header-content">
				<div class="site-branding">
					<?php
					if ( ! empty( $siteforge_media['logoUrl'] ) ) {
						?>
						<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="custom-logo-link" rel="home">
							<img src="<?php echo esc_url( $siteforge_media['logoUrl'] ); ?>" class="custom-logo" alt="<?php echo esc_attr( $siteforge_media['logoAlt'] ?? get_bloginfo( 'name' ) ); ?>">
						</a>
						<?php
					} elseif ( has_custom_logo() ) {
						the_custom_logo();
					} else {
						?>
						<h1 class="site-title">
							<a href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home">
								<?php bloginfo( 'name' ); ?>
							</a>
						</h1>
						<?php
						$blogdescription = get_bloginfo( 'description', 'display' );
						if ( $blogdescription ) {
							?>
							<p class="site-description">
								<?php echo wp_kses_post( $blogdescription ); ?>
							</p>
							<?php
						}
					}
					?>
				</div>

				<nav id="site-navigation" class="main-navigation" data-siteforge-resource="component:navigation" data-siteforge-target-id="menu:component:navigation" data-siteforge-target-kind="menu" data-siteforge-resource-path="<?php echo esc_attr( wp_json_encode( array( array( 'kind' => 'menu', 'id' => 'component:navigation' ) ), JSON_UNESCAPED_SLASHES ) ); ?>" data-siteforge-display-value="Primary navigation">
					<button class="menu-toggle" aria-controls="primary-menu" aria-expanded="false">
						<span class="hamburger-icon">
							<span></span>
							<span></span>
							<span></span>
						</span>
						<span class="menu-label">
							<?php esc_html_e( 'Menu', 'oneclick-siteforge' ); ?>
						</span>
					</button>

					<?php
					$primary_menu = wp_nav_menu(
						array(
							'theme_location' => 'primary',
							'menu_id'        => 'primary-menu',
							'container'      => 'div',
							'container_class' => 'primary-menu-container',
							'fallback_cb'    => false,
							'depth'          => 0,
							'echo'           => false,
						)
					);
					if ( $primary_menu ) {
						echo $primary_menu; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					} else {
						oneclick_siteforge_primary_menu_fallback(
							array(
								'menu_id'         => 'primary-menu',
								'container_class' => 'primary-menu-container',
							)
						);
					}
					?>
				</nav>

				<?php if ( ! empty( $siteforge_header['cta']['enabled'] ) && ! empty( $siteforge_header['cta']['href'] ) && ! empty( $siteforge_header['cta']['label'] ) ) { ?>
					<a class="header-cta" href="<?php echo esc_url( $siteforge_header['cta']['href'] ); ?>" data-siteforge-target-id="header:component:header/cta:primary" data-siteforge-target-kind="cta" data-siteforge-resource-path="<?php echo esc_attr( wp_json_encode( array( array( 'kind' => 'header', 'id' => 'component:header' ), array( 'kind' => 'cta', 'id' => 'primary' ) ), JSON_UNESCAPED_SLASHES ) ); ?>" data-siteforge-display-value="<?php echo esc_attr( $siteforge_header['cta']['label'] ); ?>">
						<?php echo esc_html( $siteforge_header['cta']['label'] ); ?>
					</a>
				<?php } ?>
			</div>
		</header>

		<div id="content" class="site-content">
