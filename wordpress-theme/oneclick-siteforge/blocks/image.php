<?php
/**
 * Block: Single Hero Image
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$image = get_field( 'image' );
$size = get_field( 'size' ) ?: 'large';
$caption = get_field( 'caption' );

if ( empty( $image ) ) {
	return;
}

$size_class = '';
switch ( $size ) {
	case 'full':
		$wp_size = 'full';
		$size_class = 'size-full';
		break;
	case 'medium':
		$wp_size = 'medium';
		$size_class = 'size-medium';
		break;
	case 'large':
	default:
		$wp_size = 'large';
		$size_class = 'size-large';
		break;
}
?>

<figure <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-image ' . $size_class ) ); ?>>
	<?php
	if ( is_array( $image ) && isset( $image['ID'] ) ) {
		echo wp_get_attachment_image(
			$image['ID'],
			$wp_size,
			false,
			array(
				'class' => 'hero-image',
				'alt'   => esc_attr( $caption ?? get_post_meta( $image['ID'], '_wp_attachment_image_alt', true ) ),
				'loading' => 'lazy',
			)
		);
	}

	if ( ! empty( $caption ) ) {
		?>
		<figcaption><?php echo wp_kses_post( $caption ); ?></figcaption>
		<?php
	}
	?>
</figure>
