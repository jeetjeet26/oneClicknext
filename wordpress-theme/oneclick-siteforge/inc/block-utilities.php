<?php
/**
 * Block utility functions
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Get block wrapper attributes
 */
function oneclick_get_block_wrapper_attributes( $extra_attrs = array() ) {
	$attrs = array(
		'class' => 'oneclick-block',
	);

	if ( isset( $GLOBALS['block'] ) ) {
		$block = $GLOBALS['block'];
		if ( isset( $block['align'] ) && in_array( $block['align'], array( 'full', 'wide' ), true ) ) {
			$attrs['class'] .= ' align' . $block['align'];
		}
		if ( isset( $block['anchor'] ) ) {
			$attrs['id'] = $block['anchor'];
		}
	}

	$attrs = array_merge( $attrs, $extra_attrs );

	$output = '';
	foreach ( $attrs as $key => $value ) {
		if ( 'class' === $key ) {
			$output .= ' class="' . esc_attr( $value ) . '"';
		} else {
			$output .= ' ' . esc_attr( $key ) . '="' . esc_attr( $value ) . '"';
		}
	}

	return $output;
}

/**
 * Render a button
 */
function oneclick_render_button( $text, $url = '#', $style = 'primary', $target = false ) {
	$class = 'btn btn-' . esc_attr( $style );
	$target_attr = $target ? ' target="_blank" rel="noopener noreferrer"' : '';

	return sprintf(
		'<a href="%s" class="%s"%s>%s</a>',
		esc_url( $url ),
		esc_attr( $class ),
		$target_attr,
		esc_html( $text )
	);
}

/**
 * Get responsive image HTML
 */
function oneclick_get_image_html( $image, $size = 'large', $attr = array() ) {
	if ( is_array( $image ) && isset( $image['ID'] ) ) {
		return wp_get_attachment_image( $image['ID'], $size, false, $attr );
	} elseif ( is_numeric( $image ) ) {
		return wp_get_attachment_image( $image, $size, false, $attr );
	}

	return '';
}

/**
 * Render icon
 */
function oneclick_render_icon( $icon, $class = '' ) {
	if ( empty( $icon ) ) {
		return '';
	}

	$icon_class = 'oneclick-icon';
	if ( ! empty( $class ) ) {
		$icon_class .= ' ' . esc_attr( $class );
	}

	if ( is_array( $icon ) && isset( $icon['ID'] ) ) {
		return wp_get_attachment_image( $icon['ID'], 'thumbnail', false, array( 'class' => $icon_class ) );
	} elseif ( is_numeric( $icon ) ) {
		return wp_get_attachment_image( $icon, 'thumbnail', false, array( 'class' => $icon_class ) );
	} elseif ( is_string( $icon ) && strpos( $icon, 'fa-' ) !== false ) {
		return sprintf( '<i class="fas %s %s"></i>', esc_attr( $icon ), esc_attr( $icon_class ) );
	}

	return '';
}

/**
 * Check if field has value
 */
function oneclick_field_has_value( $field ) {
	return ! empty( $field ) && $field !== '';
}

/**
 * Render background class
 */
function oneclick_get_background_class( $background = 'white' ) {
	$backgrounds = array(
		'white' => 'bg-white',
		'light' => 'bg-light',
		'dark'  => 'bg-dark',
	);

	return isset( $backgrounds[ $background ] ) ? $backgrounds[ $background ] : $backgrounds['white'];
}

/**
 * Get the URL from a link field (handles both string URL and array)
 */
function oneclick_get_link_url( $link ) {
	if ( is_array( $link ) ) {
		return isset( $link['url'] ) ? $link['url'] : '';
	}
	return is_string( $link ) ? $link : '';
}

/**
 * Sanitize wysiwyg content
 */
function oneclick_sanitize_wysiwyg( $content ) {
	return wp_kses_post( $content );
}

/**
 * Get image alt text
 */
function oneclick_get_image_alt( $image ) {
	if ( is_array( $image ) && isset( $image['ID'] ) ) {
		return get_post_meta( $image['ID'], '_wp_attachment_image_alt', true );
	} elseif ( is_array( $image ) && isset( $image['alt'] ) ) {
		return $image['alt'];
	}
	return '';
}

/**
 * Format number of columns
 */
function oneclick_get_column_class( $columns ) {
	$col_map = array(
		2 => 'grid-2',
		3 => 'grid-3',
		4 => 'grid-4',
	);

	return isset( $col_map[ intval( $columns ) ] ) ? $col_map[ intval( $columns ) ] : 'grid-3';
}
