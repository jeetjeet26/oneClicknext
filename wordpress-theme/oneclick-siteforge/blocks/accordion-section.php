<?php
/**
 * Block: Expandable FAQ/List
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$items = get_field( 'items' ) ?: array();

if ( empty( $items ) ) {
	return;
}

$unique_id = 'accordion-' . uniqid();
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-accordion' ) ); ?>>
	<div class="site-container">
		<div class="accordion" id="<?php echo esc_attr( $unique_id ); ?>" role="region" aria-label="<?php esc_attr_e( 'Expandable content', 'oneclick-siteforge' ); ?>">
			<?php
			foreach ( $items as $index => $item ) {
				$title = $item['title'] ?? '';
				$content = $item['content'] ?? '';

				if ( empty( $title ) ) {
					continue;
				}

				$item_id = $unique_id . '-item-' . $index;
				$button_id = $item_id . '-btn';
				$panel_id = $item_id . '-panel';
				$is_first = 0 === $index;
				?>
				<div class="accordion-item">
					<h3 class="accordion-header">
						<button
							id="<?php echo esc_attr( $button_id ); ?>"
							class="accordion-button"
							type="button"
							aria-expanded="<?php echo $is_first ? 'true' : 'false'; ?>"
							aria-controls="<?php echo esc_attr( $panel_id ); ?>"
						>
							<?php echo wp_kses_post( $title ); ?>
							<span class="accordion-icon" aria-hidden="true"></span>
						</button>
					</h3>

					<div
						id="<?php echo esc_attr( $panel_id ); ?>"
						class="accordion-panel"
						role="region"
						aria-labelledby="<?php echo esc_attr( $button_id ); ?>"
						<?php echo ! $is_first ? 'hidden' : ''; ?>
					>
						<div class="accordion-body">
							<?php echo wp_kses_post( $content ); ?>
						</div>
					</div>
				</div>
				<?php
			}
			?>
		</div>
	</div>
</section>
