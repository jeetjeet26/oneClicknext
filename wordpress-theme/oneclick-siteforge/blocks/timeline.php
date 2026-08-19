<?php
/**
 * Block: Timeline.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading    = oneclick_get_block_field( 'heading', $block, __( 'Timeline', 'oneclick-siteforge' ) );
$intro      = oneclick_get_block_field( 'intro', $block, '' );
$milestones = oneclick_get_block_field( 'milestones', $block, array() );
$milestones = is_array( $milestones ) ? $milestones : array();
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-timeline' ) ); ?>>
	<div class="site-container">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<?php if ( $intro ) : ?><p><?php echo esc_html( $intro ); ?></p><?php endif; ?>
		<ol class="timeline-list">
			<?php foreach ( $milestones as $milestone ) : ?>
				<li>
					<p><time><?php echo esc_html( $milestone['date_label'] ?? '' ); ?></time></p>
					<h3><?php echo esc_html( $milestone['title'] ?? '' ); ?></h3>
					<?php if ( ! empty( $milestone['description'] ) ) : ?><p><?php echo esc_html( $milestone['description'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $milestone['status'] ) ) : ?><p><?php echo esc_html( $milestone['status'] ); ?></p><?php endif; ?>
				</li>
			<?php endforeach; ?>
		</ol>
	</div>
</section>
