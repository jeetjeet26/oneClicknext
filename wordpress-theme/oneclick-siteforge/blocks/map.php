<?php
/**
 * Block: Google Maps Embed
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$zoom_level = get_field( 'zoom_level' ) ?: 15;
$show_directions = get_field( 'show_directions' );
$property_address = oneclick_get_field( 'property_address' );
$property_lat = oneclick_get_field( 'property_latitude' );
$property_lng = oneclick_get_field( 'property_longitude' );

if ( empty( $property_address ) ) {
	return;
}

$unique_id = 'map-' . uniqid();
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-map' ) ); ?>>
	<div class="map-container">
		<div id="<?php echo esc_attr( $unique_id ); ?>" class="map-embed" data-zoom="<?php echo intval( $zoom_level ); ?>" data-lat="<?php echo esc_attr( $property_lat ); ?>" data-lng="<?php echo esc_attr( $property_lng ); ?>" data-address="<?php echo esc_attr( $property_address ); ?>"></div>

		<?php
		if ( $show_directions ) {
			$directions_url = 'https://www.google.com/maps/search/' . urlencode( $property_address );
			?>
			<div class="map-actions">
				<a href="<?php echo esc_url( $directions_url ); ?>" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
					<?php esc_html_e( 'Get Directions', 'oneclick-siteforge' ); ?>
				</a>
			</div>
			<?php
		}
		?>
	</div>
</section>

<script>
	document.addEventListener( 'DOMContentLoaded', function() {
		const mapElement = document.getElementById( '<?php echo esc_js( $unique_id ); ?>' );
		if ( ! mapElement ) return;

		const zoom = parseInt( mapElement.dataset.zoom );
		const lat = parseFloat( mapElement.dataset.lat );
		const lng = parseFloat( mapElement.dataset.lng );
		const address = mapElement.dataset.address;
		const apiKey = '<?php echo esc_js( oneclick_get_field( 'google_maps_api_key' ) ); ?>';

		if ( ! apiKey ) {
			mapElement.innerHTML = '<p><?php esc_html_e( 'Google Maps API key not configured.', 'oneclick-siteforge' ); ?></p>';
			return;
		}

		if ( lat && lng ) {
			const script = document.createElement( 'script' );
			script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent( apiKey );
			script.async = true;
			script.defer = true;
			script.onload = function() {
				const location = { lat: lat, lng: lng };
				const map = new google.maps.Map( mapElement, {
					zoom: zoom,
					center: location,
					mapTypeControl: true,
					streetViewControl: true,
					fullscreenControl: true,
				});

				new google.maps.Marker({
					position: location,
					map: map,
					title: address,
				});
			};
			document.head.appendChild( script );
		}
	});
</script>
