<?php
/**
 * Block: Hero Image Slider
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$slides = get_field( 'slides' ) ?: array();
$autoplay = get_field( 'autoplay' );
$overlay_style = get_field( 'overlay_style' ) ?: 'gradient';

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

			if ( empty( $image ) ) {
				continue;
			}
			?>
			<div class="swiper-slide">
				<?php
				if ( is_array( $image ) && isset( $image['ID'] ) ) {
					echo wp_get_attachment_image(
						$image['ID'],
						'full',
						false,
						array(
							'class' => 'slide-image',
							'alt'   => esc_attr( $headline ),
						)
					);
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
	<div class="swiper-button-prev"></div>
	<div class="swiper-button-next"></div>
</section>
