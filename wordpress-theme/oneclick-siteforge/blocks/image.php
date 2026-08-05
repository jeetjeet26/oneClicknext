<?php
/**
 * Block: Single Hero Image
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$image = oneclick_get_block_field( 'image', $block );
$size = oneclick_get_block_field( 'size', $block, 'large' );
$caption = oneclick_get_block_field( 'caption', $block );

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

<figure <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-image ' . $size_class ) ); ?>>
	<?php
	$image_html = oneclick_get_image_html(
		$image,
		$wp_size,
		array(
			'class'   => 'hero-image',
			'alt'     => $caption ?? oneclick_get_image_alt( $image ),
			'loading' => 'lazy',
		)
	);
	if ( $image_html ) {
		echo $image_html;
	} else {
		?>
		<div class="image-placeholder" role="img" aria-label="<?php esc_attr_e( 'Property photography coming soon', 'oneclick-siteforge' ); ?>">
			<span><?php esc_html_e( 'Property photography', 'oneclick-siteforge' ); ?></span>
			<strong><?php esc_html_e( 'Coming soon', 'oneclick-siteforge' ); ?></strong>
		</div>
		<?php
	}

	if ( ! empty( $caption ) ) {
		?>
		<figcaption><?php echo wp_kses_post( $caption ); ?></figcaption>
		<?php
	}
	?>
</figure>
