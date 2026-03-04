<?php
/**
 * Custom template tags for oneClick SiteForge
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Output post meta information
 */
function oneclick_siteforge_posted_on() {
	$time_string = '<time class="entry-date published updated" datetime="%1$s">%2$s</time>';

	if ( get_the_time( 'U' ) !== get_the_modified_time( 'U' ) ) {
		$time_string = '<time class="entry-date published" datetime="%1$s">%2$s</time><time class="updated" datetime="%3$s">%4$s</time>';
	}

	printf(
		wp_kses_post( $time_string ),
		esc_attr( get_the_date( 'c' ) ),
		esc_html( get_the_date() ),
		esc_attr( get_the_modified_date( 'c' ) ),
		esc_html( get_the_modified_date() )
	);
}

/**
 * Output post author information
 */
function oneclick_siteforge_posted_by() {
	printf(
		wp_kses_post( __( 'by <span class="author vcard"><a class="url fn n" href="%1$s">%2$s</a></span>', 'oneclick-siteforge' ) ),
		esc_url( get_author_posts_url( get_the_author_meta( 'ID' ) ) ),
		esc_html( get_the_author() )
	);
}
