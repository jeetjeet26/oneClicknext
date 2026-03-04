<?php
/**
 * Block: Raw HTML
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$html_content = get_field( 'html_content' );

if ( empty( $html_content ) ) {
	return;
}
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-html' ) ); ?>>
	<div class="site-container">
		<div class="html-content">
			<?php echo wp_kses_post( $html_content ); ?>
		</div>
	</div>
</section>
