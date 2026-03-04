<?php
/**
 * Block: Photo Gallery
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$images = get_field( 'images' ) ?: array();
$layout = get_field( 'layout' ) ?: 'grid';

if ( empty( $images ) ) {
	return;
}

$layout_class = 'masonry' === $layout ? 'layout-masonry' : 'layout-grid';
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-gallery ' . $layout_class ) ); ?>>
	<div class="site-container">
		<div class="gallery-grid" id="gallery-<?php echo uniqid( 'gallery-' ); ?>">
			<?php
			foreach ( $images as $image ) {
				if ( is_array( $image ) && isset( $image['ID'] ) ) {
					$image_id = $image['ID'];
					$alt_text = get_post_meta( $image_id, '_wp_attachment_image_alt', true );
					$full_url = wp_get_attachment_url( $image_id );
					?>
					<a class="gallery-item" href="<?php echo esc_url( $full_url ); ?>" data-gallery="true" aria-label="<?php echo esc_attr( $alt_text ); ?>">
						<?php
						echo wp_get_attachment_image(
							$image_id,
							'large',
							false,
							array(
								'class' => 'gallery-image',
								'alt'   => esc_attr( $alt_text ),
								'loading' => 'lazy',
							)
						);
						?>
					</a>
					<?php
				} elseif ( is_numeric( $image ) ) {
					$alt_text = get_post_meta( $image, '_wp_attachment_image_alt', true );
					$full_url = wp_get_attachment_url( $image );
					?>
					<a class="gallery-item" href="<?php echo esc_url( $full_url ); ?>" data-gallery="true" aria-label="<?php echo esc_attr( $alt_text ); ?>">
						<?php
						echo wp_get_attachment_image(
							$image,
							'large',
							false,
							array(
								'class' => 'gallery-image',
								'alt'   => esc_attr( $alt_text ),
								'loading' => 'lazy',
							)
						);
						?>
					</a>
					<?php
				}
			}
			?>
		</div>
	</div>
</section>
