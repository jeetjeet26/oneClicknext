<?php
/**
 * The template for displaying all single pages
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();
?>

<main id="primary" class="site-main">
	<?php
	while ( have_posts() ) {
		the_post();
		$siteforge_resource_id = (string) get_post_meta( get_the_ID(), '_siteforge_v3_resource_id', true );
		$siteforge_resource_class = $siteforge_resource_id ? 'siteforge-resource-' . sanitize_html_class( $siteforge_resource_id ) : '';
		?>
		<article id="post-<?php the_ID(); ?>" <?php post_class( trim( 'siteforge-page ' . $siteforge_resource_class ) ); ?><?php if ( $siteforge_resource_id ) { ?> data-siteforge-resource="<?php echo esc_attr( $siteforge_resource_id ); ?>"<?php } ?>>
			<h1 class="screen-reader-text"><?php the_title(); ?></h1>
			<div class="page-content siteforge-page-content">
				<?php the_content(); ?>
			</div>

			<?php
			wp_link_pages(
				array(
					'before' => '<div class="page-links">',
					'after'  => '</div>',
				)
			);
			?>
		</article>
		<?php
	}
	?>
</main>

<?php
get_footer();
