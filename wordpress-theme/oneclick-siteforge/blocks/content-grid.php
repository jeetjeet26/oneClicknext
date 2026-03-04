<?php
/**
 * Block: Card Grid Layout
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$items = get_field( 'items' ) ?: array();
$columns = get_field( 'columns' ) ?: 3;

if ( empty( $items ) ) {
	return;
}

$col_class = oneclick_get_column_class( $columns );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-content-grid' ) ); ?>>
	<div class="site-container">
		<div class="grid-layout <?php echo esc_attr( $col_class ); ?>">
			<?php
			foreach ( $items as $item ) {
				$icon = $item['icon'] ?? '';
				$headline = $item['headline'] ?? '';
				$description = $item['description'] ?? '';
				$image = $item['image'] ?? '';
				?>
				<div class="grid-item">
					<div class="item-inner">
						<?php
						if ( ! empty( $image ) ) {
							?>
							<div class="item-image">
								<?php
								if ( is_array( $image ) && isset( $image['ID'] ) ) {
									echo wp_get_attachment_image(
										$image['ID'],
										'medium',
										false,
										array( 'class' => 'card-image' )
									);
								}
								?>
							</div>
							<?php
						} elseif ( ! empty( $icon ) ) {
							?>
							<div class="item-icon">
								<?php echo oneclick_render_icon( $icon ); ?>
							</div>
							<?php
						}

						if ( ! empty( $headline ) ) {
							?>
							<h3 class="item-headline"><?php echo wp_kses_post( $headline ); ?></h3>
							<?php
						}

						if ( ! empty( $description ) ) {
							?>
							<p class="item-description"><?php echo wp_kses_post( $description ); ?></p>
							<?php
						}
						?>
					</div>
				</div>
				<?php
			}
			?>
		</div>
	</div>
</section>
