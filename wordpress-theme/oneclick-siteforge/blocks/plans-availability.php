<?php
/**
 * Block: Floor Plan Browser
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$data_source = oneclick_get_block_field( 'data_source', $block, 'yardi' );
$display_style = oneclick_get_block_field( 'display_style', $block, 'interactive' );
$filter_options = oneclick_get_block_field( 'filter_options', $block, array() );
$floor_plans = oneclick_get_block_field( 'floor_plans', $block, array() );
$show_pricing = (bool) oneclick_get_block_field( 'show_pricing', $block, true );
$show_availability = (bool) oneclick_get_block_field( 'show_availability', $block, true );
$floor_plans = is_array( $floor_plans ) ? $floor_plans : array();
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

					?>
				</div>
				<?php
			}
			?>

			<div class="plans-container" id="plans-container">
				<?php
				if ( ! empty( $floor_plans ) ) {
					?>
					<div class="plans-list">
						<?php foreach ( $floor_plans as $floor_plan ) { ?>
							<?php
							$name = sanitize_text_field( $floor_plan['name'] ?? '' );
							$bedrooms = absint( $floor_plan['bedrooms'] ?? 0 );
							$bathrooms = isset( $floor_plan['bathrooms'] ) ? (float) $floor_plan['bathrooms'] : null;
							$sqft_min = isset( $floor_plan['sqft_min'] ) ? absint( $floor_plan['sqft_min'] ) : null;
							$sqft_max = isset( $floor_plan['sqft_max'] ) ? absint( $floor_plan['sqft_max'] ) : null;
							$rent_min = isset( $floor_plan['rent_min'] ) ? (float) $floor_plan['rent_min'] : null;
							$rent_max = isset( $floor_plan['rent_max'] ) ? (float) $floor_plan['rent_max'] : null;
							$available_count = isset( $floor_plan['available_count'] ) ? absint( $floor_plan['available_count'] ) : null;
							$image_url = esc_url( $floor_plan['image_url'] ?? '' );
							$image_alt = sanitize_text_field( $floor_plan['image_alt'] ?? ( $name . ' floor plan' ) );
							?>
							<article class="plan-card" data-floor-plan-row data-bedrooms="<?php echo esc_attr( $bedrooms ); ?>" data-sqft="<?php echo esc_attr( $sqft_max ?? $sqft_min ?? 0 ); ?>">
								<?php if ( $image_url ) { ?>
									<img class="plan-image" src="<?php echo $image_url; ?>" alt="<?php echo esc_attr( $image_alt ); ?>" loading="lazy" decoding="async">
								<?php } ?>
								<div class="plan-header">
									<h3><?php echo esc_html( $name ); ?></h3>
									<?php if ( $show_pricing && null !== $rent_min ) { ?>
										<div class="plan-price">
											<?php
											echo esc_html(
												null !== $rent_max && $rent_max !== $rent_min
													? sprintf( '$%1$s–$%2$s', number_format_i18n( $rent_min ), number_format_i18n( $rent_max ) )
													: sprintf( __( 'From $%s', 'oneclick-siteforge' ), number_format_i18n( $rent_min ) )
											);
											?>
										</div>
									<?php } ?>
								</div>
								<div class="plan-details">
									<p><strong><?php esc_html_e( 'Bedrooms:', 'oneclick-siteforge' ); ?></strong> <?php echo esc_html( 0 === $bedrooms ? __( 'Studio', 'oneclick-siteforge' ) : $bedrooms ); ?></p>
									<?php if ( null !== $bathrooms ) { ?><p><strong><?php esc_html_e( 'Bathrooms:', 'oneclick-siteforge' ); ?></strong> <?php echo esc_html( $bathrooms ); ?></p><?php } ?>
									<?php if ( null !== $sqft_min ) { ?><p><strong><?php esc_html_e( 'Square Footage:', 'oneclick-siteforge' ); ?></strong> <?php echo esc_html( null !== $sqft_max && $sqft_max !== $sqft_min ? number_format_i18n( $sqft_min ) . '–' . number_format_i18n( $sqft_max ) : number_format_i18n( $sqft_min ) ); ?> <?php esc_html_e( 'sq ft', 'oneclick-siteforge' ); ?></p><?php } ?>
									<?php if ( $show_availability && null !== $available_count ) { ?><p><strong><?php esc_html_e( 'Available:', 'oneclick-siteforge' ); ?></strong> <?php echo esc_html( $available_count ); ?></p><?php } ?>
								</div>
								<?php if ( ! empty( $floor_plan['specials'] ) ) { ?><p class="plan-special"><?php echo esc_html( $floor_plan['specials'] ); ?></p><?php } ?>
								<?php if ( ! empty( $floor_plan['availability_url'] ) ) { ?><a class="btn btn-secondary" href="<?php echo esc_url( $floor_plan['availability_url'] ); ?>"><?php esc_html_e( 'Check availability', 'oneclick-siteforge' ); ?></a><?php } ?>
								<?php if ( ! empty( $floor_plan['apply_url'] ) ) { ?><a class="btn btn-primary" href="<?php echo esc_url( $floor_plan['apply_url'] ); ?>"><?php esc_html_e( 'Apply now', 'oneclick-siteforge' ); ?></a><?php } ?>
							</article>
						<?php } ?>
					</div>
					<?php
				} elseif ( in_array( $data_source, array( 'siteforge', 'manual' ), true ) ) {
					?>
					<div class="plans-empty-state">
						<h2><?php esc_html_e( 'Floor plans coming soon', 'oneclick-siteforge' ); ?></h2>
						<p><?php esc_html_e( 'Check back soon for reviewed layouts, pricing, and availability.', 'oneclick-siteforge' ); ?></p>
					</div>
					<?php
				} elseif ( 'interactive' === $display_style ) {
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
