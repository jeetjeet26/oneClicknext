<?php
/**
 * Block: Image + Text Split
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$headline = get_field( 'headline' );
$content = get_field( 'content' );
$layout = get_field( 'layout' ) ?: 'image-left';
$cta_link = get_field( 'cta_link' );
$cta_text = get_field( 'cta_text' );
$image = get_field( 'image' );

if ( empty( $image ) && empty( $headline ) && empty( $content ) ) {
	return;
}

$layout_class = 'image-right' === $layout ? 'layout-image-right' : 'layout-image-left';
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-feature-section ' . $layout_class ) ); ?>>
	<div class="site-container">
		<div class="feature-grid">
			<?php
			if ( ! empty( $image ) ) {
				?>
				<div class="feature-image">
					<?php
					if ( is_array( $image ) && isset( $image['ID'] ) ) {
						echo wp_get_attachment_image(
							$image['ID'],
							'large',
							false,
							array(
								'class' => 'responsive-image',
								'alt'   => esc_attr( $headline ?? 'Feature image' ),
							)
						);
					}
					?>
				</div>
				<?php
			}
			?>

			<div class="feature-content">
				<?php
				if ( ! empty( $headline ) ) {
					?>
					<h2><?php echo wp_kses_post( $headline ); ?></h2>
					<?php
				}

				if ( ! empty( $content ) ) {
					?>
					<div class="feature-text">
						<?php echo wp_kses_post( $content ); ?>
					</div>
					<?php
				}

				if ( ! empty( $cta_text ) && ! empty( $cta_link ) ) {
					?>
					<div class="feature-cta">
						<a href="<?php echo esc_url( $cta_link ); ?>" class="btn btn-primary">
							<?php echo esc_html( $cta_text ); ?>
						</a>
					</div>
					<?php
				}
				?>
			</div>
		</div>
	</div>
</section>
