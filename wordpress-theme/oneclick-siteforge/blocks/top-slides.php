<?php
/**
 * Block: Hero Image Slider
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$slides = oneclick_get_block_field( 'slides', $block, array() );
$autoplay = oneclick_get_block_field( 'autoplay', $block, false );
$overlay_style = oneclick_get_block_field( 'overlay_style', $block, 'gradient' );

if ( empty( $slides ) ) {
	return;
}
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-top-slides swiper-container' ) ); ?> data-autoplay="<?php echo $autoplay ? 'true' : 'false'; ?>" data-overlay="<?php echo esc_attr( $overlay_style ); ?>">
	<div class="swiper-wrapper">
		<?php
		foreach ( $slides as $slide ) {
			$headline = $slide['headline'] ?? '';
			$subheadline = $slide['subheadline'] ?? '';
			$cta_text = $slide['cta_text'] ?? '';
			$cta_link = $slide['cta_link'] ?? '';
			$image = $slide['image'] ?? '';
			?>
			<div class="swiper-slide<?php echo empty( $image ) ? ' is-placeholder' : ''; ?>">
				<?php
				if ( ! empty( $image ) ) {
					echo oneclick_get_image_html(
						$image,
						'full',
						array(
							'class' => oneclick_is_placeholder_image( $image ) ? 'slide-image is-placeholder-image' : 'slide-image',
							'alt'   => $headline,
						)
					);
				} else {
					?>
					<div class="slide-image slide-image-placeholder" aria-hidden="true"></div>
					<?php
				}
				?>

				<div class="slide-overlay overlay-<?php echo esc_attr( $overlay_style ); ?>"></div>

				<div class="slide-content">
					<div class="slide-text">
						<?php
						if ( ! empty( $headline ) ) {
							?>
							<h2 class="slide-headline"><?php echo wp_kses_post( $headline ); ?></h2>
							<?php
						}

						if ( ! empty( $subheadline ) ) {
							?>
							<p class="slide-subheadline"><?php echo wp_kses_post( $subheadline ); ?></p>
							<?php
						}

						if ( ! empty( $cta_text ) && ! empty( $cta_link ) ) {
							?>
							<div class="slide-cta">
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
			<?php
		}
		?>
	</div>

	<div class="swiper-pagination"></div>
	<button type="button" class="swiper-button-prev" aria-label="<?php esc_attr_e( 'Previous slide', 'oneclick-siteforge' ); ?>"></button>
	<button type="button" class="swiper-button-next" aria-label="<?php esc_attr_e( 'Next slide', 'oneclick-siteforge' ); ?>"></button>
	<?php if ( $autoplay ) { ?>
		<button type="button" class="swiper-autoplay-toggle" aria-pressed="false">
			<?php esc_html_e( 'Pause slideshow', 'oneclick-siteforge' ); ?>
		</button>
	<?php } ?>
</section>
