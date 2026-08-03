<?php
/**
 * The footer for our theme
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$siteforge_configuration = get_option( 'oneclick_siteforge_configuration', array() );
$siteforge_footer = is_array( $siteforge_configuration['footer'] ?? null ) ? $siteforge_configuration['footer'] : array();
?>

		</div>

		<footer id="colophon" class="site-footer" data-layout="<?php echo esc_attr( $siteforge_footer['layout'] ?? 'columns' ); ?>">
			<div class="site-footer-content site-container">
				<div class="footer-grid">
					<div class="footer-section footer-about">
						<h3>
							<?php
							$property_name = oneclick_get_field( 'property_name', get_bloginfo( 'name' ) );
							echo esc_html( $property_name );
							?>
						</h3>
						<p>
							<?php
							$property_address = oneclick_get_field( 'property_address' );
							if ( $property_address ) {
								echo wp_kses_post( nl2br( $property_address ) );
							}
							?>
						</p>
						<?php if ( ! empty( $siteforge_footer['tagline'] ) ) { ?>
							<p class="footer-tagline"><?php echo esc_html( $siteforge_footer['tagline'] ); ?></p>
						<?php } ?>
					</div>

					<?php if ( ! isset( $siteforge_footer['showContact'] ) || $siteforge_footer['showContact'] ) { ?>
					<div class="footer-section footer-contact">
						<h4><?php esc_html_e( 'Contact', 'oneclick-siteforge' ); ?></h4>
						<ul>
							<?php
							$phone = oneclick_get_field( 'property_phone' );
							if ( $phone ) {
								?>
								<li>
									<a href="tel:<?php echo esc_attr( preg_replace( '/\D/', '', $phone ) ); ?>">
										<?php echo esc_html( $phone ); ?>
									</a>
								</li>
								<?php
							}

							$email = oneclick_get_field( 'property_email' );
							if ( $email ) {
								?>
								<li>
									<a href="mailto:<?php echo esc_attr( $email ); ?>">
										<?php echo esc_html( $email ); ?>
									</a>
								</li>
								<?php
							}
							?>
						</ul>
					</div>
					<?php } ?>

					<?php if ( ! isset( $siteforge_footer['showNavigation'] ) || $siteforge_footer['showNavigation'] ) { ?>
					<div class="footer-section footer-nav">
						<?php
						if ( has_nav_menu( 'footer' ) ) {
							wp_nav_menu(
								array(
									'theme_location' => 'footer',
									'container'      => 'nav',
									'container_class' => 'footer-navigation',
									'fallback_cb'    => false,
									'depth'          => 1,
								)
							);
						}
						?>
					</div>
					<?php } ?>

					<?php if ( ! isset( $siteforge_footer['showSocial'] ) || $siteforge_footer['showSocial'] ) { ?>
					<div class="footer-section footer-social">
						<h4><?php esc_html_e( 'Follow Us', 'oneclick-siteforge' ); ?></h4>
						<div class="social-links">
							<?php
							$social_links = array(
								'facebook'  => array(
									'icon' => 'fab fa-facebook-f',
									'url'  => oneclick_get_field( 'social_facebook' ),
								),
								'instagram' => array(
									'icon' => 'fab fa-instagram',
									'url'  => oneclick_get_field( 'social_instagram' ),
								),
								'twitter'   => array(
									'icon' => 'fab fa-twitter',
									'url'  => oneclick_get_field( 'social_twitter' ),
								),
								'linkedin'  => array(
									'icon' => 'fab fa-linkedin-in',
									'url'  => oneclick_get_field( 'social_linkedin' ),
								),
							);

							foreach ( $social_links as $platform => $data ) {
								if ( ! empty( $data['url'] ) ) {
									?>
									<a href="<?php echo esc_url( $data['url'] ); ?>" target="_blank" rel="noopener noreferrer" aria-label="<?php echo esc_attr( ucfirst( $platform ) ); ?>">
										<i class="<?php echo esc_attr( $data['icon'] ); ?>"></i>
									</a>
									<?php
								}
							}
							?>
						</div>
					</div>
					<?php } ?>
				</div>

				<div class="footer-bottom">
					<?php $siteforge_legal = get_option( 'oneclick_siteforge_legal', array() ); ?>
					<?php if ( ! empty( $siteforge_legal['paths'] ) ) { ?>
						<nav class="footer-legal-navigation" aria-label="<?php esc_attr_e( 'Legal', 'oneclick-siteforge' ); ?>">
							<a href="<?php echo esc_url( $siteforge_legal['paths']['privacyPath'] ); ?>"><?php esc_html_e( 'Privacy', 'oneclick-siteforge' ); ?></a>
							<a href="<?php echo esc_url( $siteforge_legal['paths']['termsPath'] ); ?>"><?php esc_html_e( 'Terms', 'oneclick-siteforge' ); ?></a>
							<a href="<?php echo esc_url( $siteforge_legal['paths']['accessibilityPath'] ); ?>"><?php esc_html_e( 'Accessibility', 'oneclick-siteforge' ); ?></a>
						</nav>
						<p class="fair-housing-disclaimer">
							<?php echo esc_html( $siteforge_legal['fairHousingDisclaimer'] ); ?>
						</p>
					<?php } ?>
					<div class="footer-credits">
						<p>
							<?php
							printf(
								wp_kses(
									/* translators: %s is the theme name */
									__( '&copy; %1$d %2$s. Powered by <a href="%3$s" target="_blank" rel="noopener">oneClick SiteForge</a>', 'oneclick-siteforge' ),
									array( 'a' => array( 'href' => array(), 'target' => array(), 'rel' => array() ) )
								),
								intval( gmdate( 'Y' ) ),
								esc_html( oneclick_get_field( 'property_name', get_bloginfo( 'name' ) ) ),
								'https://oneclickcommunities.com'
							);
							?>
						</p>
					</div>
				</div>
			</div>
		</footer>
	</div>

	<?php wp_footer(); ?>
</body>
</html>
