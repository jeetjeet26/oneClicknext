<?php
/**
 * The header for our theme
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php wp_head(); ?>
</head>

<body <?php body_class(); ?>>
	<?php wp_body_open(); ?>

	<div id="page" class="site">
		<a class="skip-link screen-reader-text" href="#primary">
			<?php esc_html_e( 'Skip to content', 'oneclick-siteforge' ); ?>
		</a>

		<header id="masthead" class="site-header">
			<div class="site-header-content">
				<div class="site-branding">
					<?php
					if ( has_custom_logo() ) {
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

				<nav id="site-navigation" class="main-navigation">
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
					wp_nav_menu(
						array(
							'theme_location' => 'primary',
							'menu_id'        => 'primary-menu',
							'container'      => 'div',
							'container_class' => 'primary-menu-container',
							'fallback_cb'    => 'wp_page_menu',
							'depth'          => 2,
						)
					);
					?>
				</nav>
			</div>
		</header>

		<div id="content" class="site-content">
