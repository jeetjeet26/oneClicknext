<?php
/**
 * Block: Events directory.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading = oneclick_get_block_field( 'heading', $block, __( 'Events', 'oneclick-siteforge' ) );
$intro   = oneclick_get_block_field( 'intro', $block, '' );
$events  = oneclick_get_block_field( 'events', $block, array() );
$events  = is_array( $events ) ? $events : array();
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-events-directory' ) ); ?>>
	<div class="site-container">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<?php if ( $intro ) : ?><p><?php echo esc_html( $intro ); ?></p><?php endif; ?>
		<div class="grid-layout grid-cols-3">
			<?php foreach ( $events as $event ) : ?>
				<?php if ( empty( $event['name'] ) || empty( $event['starts_at'] ) ) { continue; } ?>
				<article class="grid-item">
					<h3><?php echo esc_html( $event['name'] ); ?></h3>
					<p><time datetime="<?php echo esc_attr( $event['starts_at'] ); ?>"><?php echo esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $event['starts_at'] ) ) ); ?></time></p>
					<?php if ( ! empty( $event['location'] ) ) : ?><p><?php echo esc_html( $event['location'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $event['description'] ) ) : ?><p><?php echo esc_html( $event['description'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $event['url'] ) ) : ?><a href="<?php echo esc_url( $event['url'] ); ?>"><?php esc_html_e( 'Event details', 'oneclick-siteforge' ); ?></a><?php endif; ?>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>
