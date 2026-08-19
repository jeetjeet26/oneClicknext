<?php
/**
 * Block: Entity directory.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading  = oneclick_get_block_field( 'heading', $block, __( 'Directory', 'oneclick-siteforge' ) );
$intro    = oneclick_get_block_field( 'intro', $block, '' );
$entities = oneclick_get_block_field( 'entities', $block, array() );
$entities = is_array( $entities ) ? $entities : array();
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-entity-directory' ) ); ?>>
	<div class="site-container">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<?php if ( $intro ) : ?><p><?php echo esc_html( $intro ); ?></p><?php endif; ?>
		<div class="grid-layout grid-cols-3">
			<?php foreach ( $entities as $entity ) : ?>
				<?php if ( empty( $entity['name'] ) ) { continue; } ?>
				<article class="grid-item">
					<h3><?php echo esc_html( $entity['name'] ); ?></h3>
					<?php if ( ! empty( $entity['type'] ) ) : ?><p><?php echo esc_html( $entity['type'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $entity['description'] ) ) : ?><p><?php echo esc_html( $entity['description'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $entity['location'] ) ) : ?><address><?php echo esc_html( $entity['location'] ); ?></address><?php endif; ?>
					<?php if ( ! empty( $entity['url'] ) ) : ?><a href="<?php echo esc_url( $entity['url'] ); ?>"><?php esc_html_e( 'View details', 'oneclick-siteforge' ); ?></a><?php endif; ?>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>
