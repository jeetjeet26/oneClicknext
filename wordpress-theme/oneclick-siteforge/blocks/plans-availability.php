<?php
/**
 * Block: Floor Plan Browser
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$data_source = get_field( 'data_source' ) ?: 'yardi';
$display_style = get_field( 'display_style' ) ?: 'interactive';
$filter_options = get_field( 'filter_options' ) ?: array();
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-plans-availability' ) ); ?> data-source="<?php echo esc_attr( $data_source ); ?>" data-style="<?php echo esc_attr( $display_style ); ?>">
	<div class="site-container">
		<div class="plans-browser">
			<?php
			if ( ! empty( $filter_options ) ) {
				?>
				<div class="plans-filters">
					<?php
					if ( in_array( 'bedrooms', $filter_options, true ) ) {
						?>
						<div class="filter-group">
							<label for="filter-bedrooms">
								<?php esc_html_e( 'Bedrooms', 'oneclick-siteforge' ); ?>
							</label>
							<select id="filter-bedrooms" class="filter-select" data-filter="bedrooms">
								<option value=""><?php esc_html_e( 'Any', 'oneclick-siteforge' ); ?></option>
								<option value="studio"><?php esc_html_e( 'Studio', 'oneclick-siteforge' ); ?></option>
								<option value="1"><?php esc_html_e( '1 Bedroom', 'oneclick-siteforge' ); ?></option>
								<option value="2"><?php esc_html_e( '2 Bedrooms', 'oneclick-siteforge' ); ?></option>
								<option value="3"><?php esc_html_e( '3 Bedrooms', 'oneclick-siteforge' ); ?></option>
								<option value="4"><?php esc_html_e( '4+ Bedrooms', 'oneclick-siteforge' ); ?></option>
							</select>
						</div>
						<?php
					}

					if ( in_array( 'square_footage', $filter_options, true ) ) {
						?>
						<div class="filter-group">
							<label for="filter-sqft">
								<?php esc_html_e( 'Square Footage', 'oneclick-siteforge' ); ?>
							</label>
							<input type="range" id="filter-sqft" class="filter-range" data-filter="square_footage" min="300" max="3000" step="100">
							<span class="sqft-display">300 - 3000</span>
						</div>
						<?php
					}

					if ( in_array( 'family_features', $filter_options, true ) ) {
						?>
						<div class="filter-group">
							<label>
								<input type="checkbox" class="filter-checkbox" data-filter="family_features">
								<?php esc_html_e( 'Family Friendly', 'oneclick-siteforge' ); ?>
							</label>
						</div>
						<?php
					}
					?>
				</div>
				<?php
			}
			?>

			<div class="plans-container" id="plans-container">
				<?php
				if ( 'interactive' === $display_style ) {
					?>
					<div class="plans-loading">
						<p><?php esc_html_e( 'Loading floor plans...', 'oneclick-siteforge' ); ?></p>
					</div>
					<?php
				} else {
					?>
					<div class="plans-list">
						<p><?php esc_html_e( 'Floor plans are loading. Please wait...', 'oneclick-siteforge' ); ?></p>
					</div>
					<?php
				}
				?>
			</div>
		</div>
	</div>
</section>
