<?php
/**
 * The main template file
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();
?>

<main id="primary" class="site-main">
	<div class="site-container">
		<?php
		if ( have_posts() ) {
			while ( have_posts() ) {
				the_post();
				?>
				<article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
					<header class="entry-header">
						<?php
						if ( is_singular() ) {
							the_title( '<h1 class="entry-title">', '</h1>' );
						} else {
							the_title( '<h2 class="entry-title"><a href="' . esc_url( get_permalink() ) . '" rel="bookmark">', '</a></h2>' );
						}

						if ( 'post' === get_post_type() ) {
							?>
							<div class="entry-meta">
								<?php oneclick_siteforge_posted_on(); ?>
							</div>
							<?php
						}
						?>
					</header>

					<div class="entry-content">
						<?php
						if ( is_singular() ) {
							the_content();
						} else {
							the_excerpt();
						}
						?>
					</div>
				</article>
				<?php
			}

			the_posts_navigation();
		} else {
			?>
			<div class="no-results not-found">
				<header class="page-header">
					<h1 class="page-title">
						<?php esc_html_e( 'Nothing Found', 'oneclick-siteforge' ); ?>
					</h1>
				</header>

				<div class="page-content">
					<p>
						<?php esc_html_e( 'It looks like nothing was found at this location.', 'oneclick-siteforge' ); ?>
					</p>
				</div>
			</div>
			<?php
		}
		?>
	</div>
</main>

<?php
get_footer();
