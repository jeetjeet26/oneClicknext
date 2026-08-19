<?php
/**
 * Block: Approved document library.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading   = oneclick_get_block_field( 'heading', $block, __( 'Documents', 'oneclick-siteforge' ) );
$intro     = oneclick_get_block_field( 'intro', $block, '' );
$documents = oneclick_get_block_field( 'documents', $block, array() );
$documents = is_array( $documents ) ? $documents : array();
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-document-library' ) ); ?>>
	<div class="site-container">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<?php if ( $intro ) : ?><p><?php echo esc_html( $intro ); ?></p><?php endif; ?>
		<ul class="document-list">
			<?php foreach ( $documents as $document ) : ?>
				<?php if ( empty( $document['title'] ) || empty( $document['url'] ) ) { continue; } ?>
				<li>
					<a href="<?php echo esc_url( $document['url'] ); ?>"><?php echo esc_html( $document['title'] ); ?></a>
					<?php if ( ! empty( $document['description'] ) ) : ?><p><?php echo esc_html( $document['description'] ); ?></p><?php endif; ?>
					<?php if ( ! empty( $document['file_type'] ) ) : ?><span><?php echo esc_html( $document['file_type'] ); ?></span><?php endif; ?>
				</li>
			<?php endforeach; ?>
		</ul>
	</div>
</section>
