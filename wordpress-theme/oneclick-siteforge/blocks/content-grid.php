<?php
/**
 * Block: Card Grid Layout
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$items = oneclick_get_block_field( 'items', $block, array() );
$columns = oneclick_get_block_field( 'columns', $block, 3 );

if ( empty( $items ) ) {
	return;
}

$col_class = oneclick_get_column_class( $columns );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-content-grid' ) ); ?>>
	<div class="site-container">
		<div class="grid-layout <?php echo esc_attr( $col_class ); ?>">
			<?php
			foreach ( $items as $item ) {
				$item_id = oneclick_siteforge_repeater_item_id( $item );
				$icon = $item['icon'] ?? '';
				$headline = $item['headline'] ?? '';
				$description = $item['description'] ?? '';
				$image = $item['image'] ?? '';
				?>
				<div class="grid-item"<?php echo oneclick_siteforge_target_attributes( $block, 'repeater_item', $item_id, $headline ); ?>>
					<div class="item-inner">
						<?php
						if ( ! empty( $image ) ) {
							?>
							<div class="item-image">
								<?php
								echo oneclick_get_image_html(
									$image,
									'large',
									array_merge(
										array(
											'class' => 'card-image',
											'alt'   => $headline,
										),
										oneclick_siteforge_target_attribute_map( $block, 'image', 'image', $headline, 'repeater_item', $item_id )
									)
								);
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
							<h3 class="item-headline"<?php echo oneclick_siteforge_target_attributes( $block, 'headline', 'headline', $headline, 'repeater_item', $item_id ); ?>><?php echo wp_kses_post( $headline ); ?></h3>
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
