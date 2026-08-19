<?php
/**
 * Block: Accessible offering comparison.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading = oneclick_get_block_field( 'heading', $block, __( 'Compare options', 'oneclick-siteforge' ) );
$intro   = oneclick_get_block_field( 'intro', $block, '' );
$columns = oneclick_get_block_field( 'columns', $block, array() );
$rows    = oneclick_get_block_field( 'rows', $block, array() );
$columns = is_array( $columns ) ? $columns : array();
$rows    = is_array( $rows ) ? $rows : array();
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-comparison-table' ) ); ?>>
	<div class="site-container">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<?php if ( $intro ) : ?><p><?php echo esc_html( $intro ); ?></p><?php endif; ?>
		<div class="table-scroll" tabindex="0">
			<table>
				<thead><tr><th scope="col"><?php esc_html_e( 'Offering', 'oneclick-siteforge' ); ?></th><?php foreach ( $columns as $column ) : ?><th scope="col"><?php echo esc_html( $column['label'] ?? '' ); ?></th><?php endforeach; ?></tr></thead>
				<tbody>
					<?php foreach ( $rows as $row ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( $row['label'] ?? '' ); ?></th>
							<?php foreach ( $columns as $column ) : ?><td><?php echo esc_html( $row['values'][ $column['key'] ?? '' ] ?? '' ); ?></td><?php endforeach; ?>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
	</div>
</section>
