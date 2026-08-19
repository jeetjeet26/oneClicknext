<?php
/**
 * Block: Points of Interest Map
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$runtime_data = is_array( $block['data'] ?? null ) ? $block['data'] : array();
$categories = get_field( 'categories' ) ?: ( $runtime_data['categories'] ?? array() );
$intro_text = get_field( 'intro_text' ) ?: ( $runtime_data['intro_text'] ?? '' );
$radius_miles = get_field( 'radius_miles' ) ?: ( $runtime_data['radius_miles'] ?? 1 );
$points = get_field( 'points' ) ?: ( $runtime_data['points'] ?? array() );
$property_lat = oneclick_get_field( 'property_latitude' );
$property_lng = oneclick_get_field( 'property_longitude' );
$api_key = oneclick_get_field( 'google_maps_api_key' );
$has_map = ! empty( $categories ) && ! empty( $property_lat ) && ! empty( $property_lng ) && ! empty( $api_key );

if ( ! $has_map && empty( $points ) && empty( $intro_text ) ) {
	return;
}

$unique_id = 'poi-map-' . uniqid();
$categories_json = wp_json_encode( $categories );
$radius_meters = intval( $radius_miles ) * 1609.34;
?>

<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-poi' ) ); ?>>
	<div class="site-container">
		<?php
		if ( ! empty( $intro_text ) ) {
			?>
			<p class="poi-intro"><?php echo wp_kses_post( $intro_text ); ?></p>
			<?php
		}
		?>

		<?php if ( $has_map ) { ?>
		<div class="poi-container">
			<div id="<?php echo esc_attr( $unique_id ); ?>" class="poi-map" data-lat="<?php echo esc_attr( $property_lat ); ?>" data-lng="<?php echo esc_attr( $property_lng ); ?>" data-radius="<?php echo esc_attr( $radius_meters ); ?>" data-categories="<?php echo esc_attr( $categories_json ); ?>"></div>

			<div class="poi-legend">
				<h3><?php esc_html_e( 'Nearby Amenities', 'oneclick-siteforge' ); ?></h3>
				<ul>
					<?php
					$category_labels = array(
						'restaurants' => __( 'Restaurants & Dining', 'oneclick-siteforge' ),
						'shopping'    => __( 'Shopping', 'oneclick-siteforge' ),
						'entertainment' => __( 'Entertainment', 'oneclick-siteforge' ),
						'transit'     => __( 'Public Transit', 'oneclick-siteforge' ),
					);

					foreach ( $categories as $category ) {
						if ( isset( $category_labels[ $category ] ) ) {
							?>
							<li>
								<span class="legend-marker marker-<?php echo esc_attr( $category ); ?>"></span>
								<?php echo esc_html( $category_labels[ $category ] ); ?>
							</li>
							<?php
						}
					}
					?>
				</ul>
			</div>
		</div>
		<?php } elseif ( ! empty( $points ) ) { ?>
		<div class="poi-list" aria-label="<?php esc_attr_e( 'Nearby places', 'oneclick-siteforge' ); ?>">
			<?php foreach ( $points as $point ) { ?>
				<article class="poi-list-item">
					<h3><?php echo esc_html( $point['name'] ?? '' ); ?></h3>
					<?php if ( ! empty( $point['category'] ) ) { ?>
						<p class="poi-category"><?php echo esc_html( $point['category'] ); ?></p>
					<?php } ?>
					<?php if ( ! empty( $point['address'] ) ) { ?>
						<p><?php echo esc_html( $point['address'] ); ?></p>
					<?php } ?>
					<?php if ( isset( $point['distance_miles'] ) && '' !== $point['distance_miles'] ) { ?>
						<p><?php echo esc_html( number_format_i18n( (float) $point['distance_miles'], 1 ) ); ?> <?php esc_html_e( 'miles away', 'oneclick-siteforge' ); ?></p>
					<?php } elseif ( ! empty( $point['travel_time_minutes'] ) ) { ?>
						<p><?php echo esc_html( absint( $point['travel_time_minutes'] ) ); ?> <?php esc_html_e( 'minutes away', 'oneclick-siteforge' ); ?></p>
					<?php } ?>
					<?php if ( ! empty( $point['source_url'] ) ) { ?>
						<a href="<?php echo esc_url( $point['source_url'] ); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Learn more', 'oneclick-siteforge' ); ?></a>
					<?php } ?>
				</article>
			<?php } ?>
		</div>
		<?php } ?>
	</div>
</section>

<?php if ( $has_map ) { ?>
<script>
	document.addEventListener( 'DOMContentLoaded', function() {
		const poiElement = document.getElementById( '<?php echo esc_js( $unique_id ); ?>' );
		if ( ! poiElement ) return;

		const lat = parseFloat( poiElement.dataset.lat );
		const lng = parseFloat( poiElement.dataset.lng );
		const radius = parseFloat( poiElement.dataset.radius );
		const categories = JSON.parse( poiElement.dataset.categories || '[]' );
		const apiKey = '<?php echo esc_js( $api_key ); ?>';

		if ( ! apiKey ) {
			poiElement.innerHTML = '<p><?php esc_html_e( 'Google Maps API key not configured.', 'oneclick-siteforge' ); ?></p>';
			return;
		}

		const script = document.createElement( 'script' );
		script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent( apiKey ) + '&libraries=places';
		script.async = true;
		script.defer = true;
		script.onload = function() {
			const location = { lat: lat, lng: lng };
			const map = new google.maps.Map( poiElement, {
				zoom: 14,
				center: location,
				mapTypeControl: true,
				fullscreenControl: true,
			});

			new google.maps.Marker({
				position: location,
				map: map,
				title: '<?php esc_attr_e( 'Property Location', 'oneclick-siteforge' ); ?>',
				icon: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
			});

			const placesService = new google.maps.places.PlacesService( map );
			const typeMap = {
				'restaurants': ['restaurant'],
				'shopping': ['shopping_mall', 'store'],
				'entertainment': ['movie_theater', 'amusement_park', 'park'],
				'transit': ['subway_station', 'bus_station', 'train_station'],
			};

			const colors = {
				'restaurants': 'FF5733',
				'shopping': 'FFC300',
				'entertainment': 'DAF7A6',
				'transit': 'C70039',
			};

			categories.forEach( function( category ) {
				const types = typeMap[category] || [];
				if ( types.length === 0 ) return;

				const nearbyRequest = {
					location: location,
					radius: radius,
					type: types[0],
				};

				placesService.nearbySearch( nearbyRequest, function( results, status ) {
					if ( status === google.maps.places.PlacesServiceStatus.OK ) {
						results.forEach( function( place ) {
							const color = colors[category] || 'CCCCCC';
							new google.maps.Marker({
								position: place.geometry.location,
								map: map,
								title: place.name,
								icon: 'https://maps.google.com/mapfiles/ms/icons/' + color + '-dot.png',
							});
						});
					}
				});
			});
		};
		document.head.appendChild( script );
	});
</script>
<?php } ?>
