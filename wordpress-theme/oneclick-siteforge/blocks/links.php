<?php
/**
 * Block: CTA Button Group
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$links = get_field( 'links' ) ?: array();

if ( empty( $links ) ) {
	return;
}
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-links' ) ); ?>>
	<div class="site-container">
		<div class="links-wrapper">
			<?php
			foreach ( $links as $link ) {
				$url = $link['url'] ?? '';
				$text = $link['text'] ?? '';
				$style = $link['style'] ?? 'primary';

				if ( empty( $url ) || empty( $text ) ) {
					continue;
				}

				$button_class = 'btn btn-' . esc_attr( $style );
				?>
				<a href="<?php echo esc_url( $url ); ?>" class="<?php echo esc_attr( $button_class ); ?>">
					<?php echo esc_html( $text ); ?>
				</a>
				<?php
			}
			?>
		</div>
	</div>
</section>
