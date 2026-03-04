<?php
/**
 * Block: Rich Text Content
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$headline = get_field( 'headline' );
$subheading = get_field( 'subheading' );
$content = get_field( 'content' );
$layout = get_field( 'layout' ) ?: 'center';
$background = get_field( 'background' ) ?: 'white';

if ( empty( $headline ) && empty( $content ) ) {
	return;
}

$layout_class = 'center' === $layout ? 'text-center' : 'text-left';
$bg_class = oneclick_get_background_class( $background );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-text-section ' . $bg_class . ' ' . $layout_class ) ); ?>>
	<div class="site-container">
		<?php
		if ( ! empty( $headline ) ) {
			?>
			<h2 class="section-headline"><?php echo wp_kses_post( $headline ); ?></h2>
			<?php
		}

		if ( ! empty( $subheading ) ) {
			?>
			<p class="section-subheading"><?php echo wp_kses_post( $subheading ); ?></p>
			<?php
		}

		if ( ! empty( $content ) ) {
			?>
			<div class="section-content">
				<?php echo wp_kses_post( $content ); ?>
			</div>
			<?php
		}
		?>
	</div>
</section>
