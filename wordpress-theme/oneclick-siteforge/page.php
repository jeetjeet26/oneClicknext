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
		?>
		<article id="post-<?php the_ID(); ?>" <?php post_class( 'siteforge-page' ); ?>>
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
