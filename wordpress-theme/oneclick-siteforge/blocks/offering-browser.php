<?php
/**
 * Block: Source-governed offering browser.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading          = oneclick_get_block_field( 'heading', $block, __( 'Offerings', 'oneclick-siteforge' ) );
$intro            = oneclick_get_block_field( 'intro', $block, '' );
$offerings        = oneclick_get_block_field( 'offerings', $block, array() );
$snapshot         = oneclick_get_block_field( 'catalog_snapshot', $block, array() );
$show_pricing     = (bool) oneclick_get_block_field( 'show_pricing', $block, false );
$show_availability = (bool) oneclick_get_block_field( 'show_availability', $block, false );
$offerings        = is_array( $offerings ) ? $offerings : array();
$snapshot         = is_array( $snapshot ) ? $snapshot : array();
$fresh_until      = isset( $snapshot['fresh_until'] ) ? strtotime( $snapshot['fresh_until'] ) : false;
$is_fresh         = ! $fresh_until || $fresh_until > time();

if ( ! $is_fresh ) {
	$show_pricing      = false;
	$show_availability = false;
}
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-offering-browser' ) ); ?>>
	<div class="site-container">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<?php if ( $intro ) : ?><p><?php echo esc_html( $intro ); ?></p><?php endif; ?>
		<div class="grid-layout grid-cols-3">
			<?php foreach ( $offerings as $offering ) : ?>
				<?php if ( empty( $offering['name'] ) ) { continue; } ?>
				<article class="grid-item">
					<h3><?php echo esc_html( $offering['name'] ); ?></h3>
					<?php if ( ! empty( $offering['description'] ) ) : ?><p><?php echo esc_html( $offering['description'] ); ?></p><?php endif; ?>
					<?php if ( $show_pricing && ! empty( $offering['price_label'] ) ) : ?><p><?php echo esc_html( $offering['price_label'] ); ?></p><?php endif; ?>
					<?php if ( $show_availability && ! empty( $offering['availability_label'] ) ) : ?><p><?php echo esc_html( $offering['availability_label'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $offering['detail_url'] ) ) : ?><a class="btn btn-secondary" href="<?php echo esc_url( $offering['detail_url'] ); ?>"><?php esc_html_e( 'View details', 'oneclick-siteforge' ); ?></a><?php endif; ?>
				</article>
			<?php endforeach; ?>
		</div>
		<?php if ( empty( $offerings ) ) : ?><p role="status"><?php esc_html_e( 'Current offerings are unavailable. Please contact us for details.', 'oneclick-siteforge' ); ?></p><?php endif; ?>
	</div>
</section>
