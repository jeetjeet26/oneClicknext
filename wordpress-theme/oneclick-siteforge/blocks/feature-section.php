<?php
/**
 * Block: Image + Text Split
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$headline = oneclick_get_block_field( 'headline', $block );
$content = oneclick_get_block_field( 'content', $block );
$layout = oneclick_get_block_field( 'layout', $block, 'image-left' );
$cta_link = oneclick_get_block_field( 'cta_link', $block );
$cta_text = oneclick_get_block_field( 'cta_text', $block );
$image = oneclick_get_block_field( 'image', $block );

if ( empty( $image ) && empty( $headline ) && empty( $content ) ) {
	return;
}

$layout_class = 'image-right' === $layout ? 'layout-image-right' : 'layout-image-left';
?>

<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-feature-section ' . $layout_class ) ); ?>>
	<div class="site-container">
		<div class="feature-grid">
			<?php
			if ( ! empty( $image ) ) {
				?>
				<div class="feature-image<?php echo oneclick_is_placeholder_image( $image ) ? ' is-placeholder-image' : ''; ?>">
					<?php
					echo oneclick_get_image_html(
						$image,
						'large',
						array(
							'class' => 'responsive-image',
							'alt'   => $headline ?? 'Feature image',
						)
					);
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
