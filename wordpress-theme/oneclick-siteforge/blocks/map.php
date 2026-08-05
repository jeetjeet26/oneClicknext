<?php
/**
 * Block: Google Maps Embed
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$zoom_level      = oneclick_get_block_field( 'zoom_level', $block, 15 );
$show_directions = oneclick_get_block_field( 'show_directions', $block, true );
$property_address = oneclick_get_block_field( 'address', $block );
$property_lat     = oneclick_get_block_field( 'latitude', $block );
$property_lng     = oneclick_get_block_field( 'longitude', $block );
$api_key          = oneclick_get_field( 'google_maps_api_key' );

if ( ! is_string( $property_address ) || '' === trim( $property_address ) ) {
	$property_address = oneclick_get_field( 'property_address' );
}
if ( ! is_numeric( $property_lat ) ) {
	$property_lat = oneclick_get_field( 'property_latitude' );
}
if ( ! is_numeric( $property_lng ) ) {
	$property_lng = oneclick_get_field( 'property_longitude' );
}

$has_address = is_string( $property_address ) && '' !== trim( $property_address );
$has_coordinates = is_numeric( $property_lat ) &&
	is_numeric( $property_lng ) &&
	(float) $property_lat >= -90 &&
	(float) $property_lat <= 90 &&
	(float) $property_lng >= -180 &&
	(float) $property_lng <= 180;
$can_render_map = $has_coordinates && is_string( $api_key ) && '' !== trim( $api_key );
$destination = $has_address
	? trim( $property_address )
	: ( $has_coordinates ? $property_lat . ',' . $property_lng : '' );
$block_identity = isset( $block['id'] ) ? (string) $block['id'] : wp_unique_id( 'siteforge-map-' );
$unique_id = 'map-' . sanitize_html_class( $block_identity );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-map' ) ); ?>>
	<div class="map-container">
		<?php if ( $can_render_map ) { ?>
			<div id="<?php echo esc_attr( $unique_id ); ?>" class="map-embed" data-zoom="<?php echo intval( $zoom_level ); ?>" data-lat="<?php echo esc_attr( $property_lat ); ?>" data-lng="<?php echo esc_attr( $property_lng ); ?>" data-address="<?php echo esc_attr( $has_address ? $property_address : '' ); ?>"></div>
		<?php } elseif ( $has_address || $has_coordinates ) { ?>
			<div class="map-fallback" data-map-state="keyless">
				<p class="map-fallback-label"><?php esc_html_e( 'Property location', 'oneclick-siteforge' ); ?></p>
				<?php if ( $has_address ) { ?>
					<address><?php echo esc_html( $property_address ); ?></address>
				<?php } else { ?>
					<p><?php echo esc_html( $property_lat . ', ' . $property_lng ); ?></p>
				<?php } ?>
				<p class="map-fallback-note"><?php esc_html_e( 'Interactive map tiles are unavailable. Use the sourced location or directions link below.', 'oneclick-siteforge' ); ?></p>
			</div>
		<?php } else { ?>
			<p class="map-fallback map-unavailable" role="status">
				<?php esc_html_e( 'Property location details are not available.', 'oneclick-siteforge' ); ?>
			</p>
		<?php } ?>

		<?php
		if ( $show_directions && '' !== $destination ) {
			$directions_url = 'https://www.google.com/maps/dir/?api=1&destination=' . rawurlencode( $destination );
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

<?php if ( $can_render_map ) { ?>
<script>
	document.addEventListener( 'DOMContentLoaded', function() {
		const mapElement = document.getElementById( '<?php echo esc_js( $unique_id ); ?>' );
		if ( ! mapElement ) return;

		const zoom = parseInt( mapElement.dataset.zoom );
		const lat = parseFloat( mapElement.dataset.lat );
		const lng = parseFloat( mapElement.dataset.lng );
		const address = mapElement.dataset.address;
		const apiKey = '<?php echo esc_js( $api_key ); ?>';

		if ( Number.isFinite( lat ) && Number.isFinite( lng ) ) {
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
<?php } ?>
