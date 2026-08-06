<?php
/**
 * Block: ReviewFlow Testimonials
 *
 * Renders only source-managed reviews embedded in the immutable SiteForge
 * artifact. No live third-party content is fetched at render time.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading = oneclick_get_block_field( 'heading', $block, 'Resident experiences' );
$reviews = oneclick_get_block_field( 'reviews', $block, array() );

if ( empty( $reviews ) ) {
	return;
}
?>

<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-testimonials' ) ); ?>>
	<div class="site-container">
		<?php if ( ! empty( $heading ) ) { ?>
			<h2 class="testimonials-heading"><?php echo esc_html( $heading ); ?></h2>
		<?php } ?>
		<div class="testimonials-grid">
			<?php foreach ( $reviews as $review ) { ?>
				<figure class="testimonial-card">
					<div class="testimonial-rating" aria-label="<?php echo esc_attr( sprintf( __( '%d out of 5 stars', 'oneclick-siteforge' ), (int) ( $review['rating'] ?? 0 ) ) ); ?>">
						<?php echo esc_html( str_repeat( '★', max( 0, min( 5, (int) ( $review['rating'] ?? 0 ) ) ) ) ); ?>
					</div>
					<blockquote>
						<p><?php echo esc_html( $review['review_text'] ?? '' ); ?></p>
					</blockquote>
					<figcaption>
						<strong><?php echo esc_html( $review['reviewer_name'] ?? __( 'Verified resident', 'oneclick-siteforge' ) ); ?></strong>
						<span><?php echo esc_html( $review['platform'] ?? '' ); ?></span>
					</figcaption>
				</figure>
			<?php } ?>
		</div>
	</div>
</section>
