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
$property_name = oneclick_get_field( 'property_name', get_bloginfo( 'name' ) );
$property_address = oneclick_get_field( 'property_address' );
$phone = oneclick_get_field( 'property_phone' );
$email = oneclick_get_field( 'property_email' );
$social_links = array(
	'facebook'  => oneclick_get_field( 'social_facebook' ),
	'instagram' => oneclick_get_field( 'social_instagram' ),
	'twitter'   => oneclick_get_field( 'social_twitter' ),
	'linkedin'  => oneclick_get_field( 'social_linkedin' ),
);
$has_social_links = (bool) array_filter( $social_links );
?>

		</div>

		<footer id="colophon" class="site-footer" data-layout="<?php echo esc_attr( $siteforge_footer['layout'] ?? 'columns' ); ?>" data-siteforge-resource="component:footer" data-siteforge-target-id="footer:component:footer" data-siteforge-target-kind="footer" data-siteforge-resource-path="<?php echo esc_attr( wp_json_encode( array( array( 'kind' => 'footer', 'id' => 'component:footer' ) ), JSON_UNESCAPED_SLASHES ) ); ?>" data-siteforge-display-value="Site footer">
			<div class="site-footer-content site-container">
				<div class="footer-grid">
					<div class="footer-section footer-about">
						<h3>
							<?php
							echo esc_html( $property_name );
							?>
						</h3>
						<p>
							<?php
							if ( $property_address ) {
								echo wp_kses_post( nl2br( $property_address ) );
							}
							?>
						</p>
						<?php if ( ! empty( $siteforge_footer['tagline'] ) ) { ?>
							<p class="footer-tagline"><?php echo esc_html( $siteforge_footer['tagline'] ); ?></p>
						<?php } ?>
					</div>

					<?php if ( ( ! isset( $siteforge_footer['showContact'] ) || $siteforge_footer['showContact'] ) && ( $phone || $email ) ) { ?>
					<div class="footer-section footer-contact">
						<h4><?php esc_html_e( 'Contact', 'oneclick-siteforge' ); ?></h4>
						<ul>
							<?php
							if ( $phone ) {
								?>
								<li>
									<a href="tel:<?php echo esc_attr( preg_replace( '/\D/', '', $phone ) ); ?>">
										<?php echo esc_html( $phone ); ?>
									</a>
								</li>
								<?php
							}

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

					<?php if ( ( ! isset( $siteforge_footer['showSocial'] ) || $siteforge_footer['showSocial'] ) && $has_social_links ) { ?>
					<div class="footer-section footer-social">
						<h4><?php esc_html_e( 'Follow Us', 'oneclick-siteforge' ); ?></h4>
						<div class="social-links">
							<?php
							$social_icons = array(
								'facebook'  => 'fab fa-facebook-f',
								'instagram' => 'fab fa-instagram',
								'twitter'   => 'fab fa-twitter',
								'linkedin'  => 'fab fa-linkedin-in',
							);

							foreach ( $social_links as $platform => $url ) {
								if ( ! empty( $url ) ) {
									?>
									<a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer" aria-label="<?php echo esc_attr( ucfirst( $platform ) ); ?>">
										<i class="<?php echo esc_attr( $social_icons[ $platform ] ); ?>"></i>
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
					<?php
					$siteforge_legal_policies = is_array( $siteforge_legal['policyBodies'] ?? null ) ? $siteforge_legal['policyBodies'] : array();
					$siteforge_legal_paths = is_array( $siteforge_legal['paths'] ?? null ) ? $siteforge_legal['paths'] : array();
					$privacy_path = $siteforge_legal['privacyPath'] ?? ( $siteforge_legal_paths['privacyPath'] ?? '' );
					$terms_path = $siteforge_legal['termsPath'] ?? ( $siteforge_legal_paths['termsPath'] ?? '' );
					$accessibility_path = $siteforge_legal['accessibilityPath'] ?? ( $siteforge_legal_paths['accessibilityPath'] ?? '' );
					$fair_housing_disclaimer = $siteforge_legal_policies['fairHousing'] ?? ( $siteforge_legal['fairHousingDisclaimer'] ?? '' );
					$siteforge_v3_legal = get_option( 'oneclick_siteforge_legal_v3', array() );
					?>
					<?php if ( is_array( $siteforge_v3_legal ) && ! empty( $siteforge_v3_legal ) ) { ?>
						<div class="footer-legal-surfaces">
							<?php foreach ( $siteforge_v3_legal as $policy ) { ?>
								<details data-siteforge-legal-resource="<?php echo esc_attr( $policy['resourceId'] ?? '' ); ?>">
									<summary><?php echo esc_html( ucwords( str_replace( '_', ' ', $policy['policyType'] ) ) ); ?></summary>
									<?php if ( ! empty( $policy['effectiveAt'] ) ) { ?>
										<p><small><?php esc_html_e( 'Effective', 'oneclick-siteforge' ); ?> <time datetime="<?php echo esc_attr( $policy['effectiveAt'] ); ?>"><?php echo esc_html( substr( $policy['effectiveAt'], 0, 10 ) ); ?></time></small></p>
									<?php } ?>
									<div><?php echo wp_kses_post( wpautop( $policy['body'] ?? '' ) ); ?></div>
								</details>
							<?php } ?>
						</div>
					<?php } ?>
					<?php if ( $privacy_path && $terms_path && $accessibility_path ) { ?>
						<nav class="footer-legal-navigation" aria-label="<?php esc_attr_e( 'Legal', 'oneclick-siteforge' ); ?>">
							<a href="<?php echo esc_url( $privacy_path ); ?>"><?php esc_html_e( 'Privacy', 'oneclick-siteforge' ); ?></a>
							<a href="<?php echo esc_url( $terms_path ); ?>"><?php esc_html_e( 'Terms', 'oneclick-siteforge' ); ?></a>
							<a href="<?php echo esc_url( $accessibility_path ); ?>"><?php esc_html_e( 'Accessibility', 'oneclick-siteforge' ); ?></a>
						</nav>
					<?php } ?>
					<?php if ( $fair_housing_disclaimer ) { ?>
						<p class="fair-housing-disclaimer">
							<?php echo esc_html( $fair_housing_disclaimer ); ?>
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
