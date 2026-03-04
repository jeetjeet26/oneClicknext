<?php
/**
 * Block: Sub-Navigation
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$menu_items = get_field( 'menu_items' ) ?: array();

if ( empty( $menu_items ) ) {
	return;
}
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-menu' ) ); ?>>
	<div class="site-container">
		<nav class="submenu-nav" aria-label="<?php esc_attr_e( 'Section Navigation', 'oneclick-siteforge' ); ?>">
			<ul class="submenu-list">
				<?php
				foreach ( $menu_items as $item ) {
					$label = $item['label'] ?? '';
					$link = $item['link'] ?? '';

					if ( empty( $label ) || empty( $link ) ) {
						continue;
					}
					?>
					<li class="submenu-item">
						<a href="<?php echo esc_url( $link ); ?>" class="submenu-link">
							<?php echo esc_html( $label ); ?>
						</a>
					</li>
					<?php
				}
				?>
			</ul>
		</nav>
	</div>
</section>
