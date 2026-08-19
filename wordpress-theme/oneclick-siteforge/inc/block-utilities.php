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
function oneclick_get_block_wrapper_attributes( $block, $extra_attrs = array() ) {
	$block = is_array( $block ) ? $block : array();
	$attrs = array(
		'class' => 'oneclick-block',
	);

	$block_name = isset( $block['name'] ) ? $block['name'] : '';
	if ( $block_name ) {
		$attrs['data-siteforge-block'] = $block_name;
	}
	$siteforge_section_id = $block['siteforgeSectionId'] ?? ( $block['data']['_siteforge_section_id'] ?? '' );
	if ( $siteforge_section_id ) {
		$resource_id = (string) $siteforge_section_id;
		$section_id  = preg_replace( '/^section:[^:]+:/', '', $resource_id );
		$attrs['data-siteforge-resource'] = $resource_id;
		$attrs['data-siteforge-section-id'] = $section_id;
	}
	$variant    = oneclick_get_block_field( 'variant', $block, '' );
	$catalog    = oneclick_siteforge_variant_catalog();
	if ( isset( $catalog[ $block_name ] ) && in_array( $variant, $catalog[ $block_name ], true ) ) {
		$attrs['class'] .= ' variant-' . sanitize_html_class( $variant );
	}
	$presentation = oneclick_get_block_field( '_siteforge_presentation', $block, array() );
	if ( is_array( $presentation ) ) {
		$presentation_values = array(
			'containerMode' => array( 'contained', 'full-width', 'full-bleed' ),
			'alignment' => array( 'left', 'center', 'right', 'stretch' ),
			'widthPreset' => array( 'narrow', 'content', 'wide', 'full' ),
			'spacingPreset' => array( 'none', 'compact', 'standard', 'spacious' ),
			'typographyPreset' => array( 'default', 'editorial', 'display', 'compact' ),
			'motionPreset' => array( 'none', 'subtle', 'expressive' ),
		);
		$safe_presentation = array();
		foreach ( $presentation_values as $field => $allowed ) {
			if ( isset( $presentation[ $field ] ) && in_array( $presentation[ $field ], $allowed, true ) ) {
				$safe_presentation[ $field ] = $presentation[ $field ];
				$attrs['class'] .= ' presentation-' . sanitize_html_class( $field ) . '-' . sanitize_html_class( $presentation[ $field ] );
			}
		}
		foreach ( array( 'mobile', 'tablet', 'desktop', 'wide' ) as $breakpoint ) {
			$override = $presentation['breakpointOverrides'][ $breakpoint ] ?? null;
			if ( ! is_array( $override ) ) {
				continue;
			}
			foreach ( $presentation_values as $field => $allowed ) {
				if ( isset( $override[ $field ] ) && in_array( $override[ $field ], $allowed, true ) ) {
					$safe_presentation['breakpointOverrides'][ $breakpoint ][ $field ] = $override[ $field ];
				}
			}
		}
		if ( ! empty( $safe_presentation ) ) {
			$attrs['data-siteforge-presentation'] = wp_json_encode( $safe_presentation, JSON_UNESCAPED_SLASHES );
		}
	}
	if ( ! empty( $block['className'] ) ) {
		foreach ( preg_split( '/\s+/', (string) $block['className'] ) as $class_name ) {
			$sanitized = sanitize_html_class( $class_name );
			if ( '' !== $sanitized ) {
				$attrs['class'] .= ' ' . $sanitized;
			}
		}
	}
	if ( isset( $block['align'] ) && in_array( $block['align'], array( 'full', 'wide' ), true ) ) {
		$attrs['class'] .= ' align' . $block['align'];
	}
	if ( ! empty( $block['anchor'] ) ) {
		$attrs['id'] = $block['anchor'];
		if ( empty( $attrs['data-siteforge-section-id'] ) && 0 === strpos( $block['anchor'], 'anchor:' ) ) {
			$attrs['data-siteforge-section-id'] = substr( $block['anchor'], 7 );
		}
	} elseif ( ! empty( $block['id'] ) ) {
		$attrs['id'] = $block['id'];
	}
	if ( ! empty( $block['siteforgeA11y'] ) && is_array( $block['siteforgeA11y'] ) ) {
		foreach ( $block['siteforgeA11y'] as $annotation ) {
			if ( ! is_array( $annotation ) ) {
				continue;
			}
			if ( ! empty( $annotation['role'] ) && empty( $attrs['role'] ) ) {
				$attrs['role'] = $annotation['role'];
			}
			if ( ! empty( $annotation['accessibleName'] ) && empty( $attrs['aria-label'] ) ) {
				$attrs['aria-label'] = $annotation['accessibleName'];
			}
			if ( ! empty( $annotation['description'] ) && empty( $attrs['aria-description'] ) ) {
				$attrs['aria-description'] = $annotation['description'];
			}
			if ( ! empty( $annotation['liveRegion'] ) && 'off' !== $annotation['liveRegion'] && empty( $attrs['aria-live'] ) ) {
				$attrs['aria-live'] = $annotation['liveRegion'];
			}
			if ( ! empty( $annotation['keyboardBehavior'] ) ) {
				$attrs['data-siteforge-keyboard'] = implode( ' ', array_map( 'sanitize_key', $annotation['keyboardBehavior'] ) );
			}
		}
	}

	if ( isset( $extra_attrs['class'] ) ) {
		$attrs['class'] = trim( $attrs['class'] . ' ' . $extra_attrs['class'] );
		unset( $extra_attrs['class'] );
	}
	$attrs = array_merge( $attrs, $extra_attrs );
	if ( $siteforge_section_id ) {
		$attrs = array_merge(
			$attrs,
			oneclick_siteforge_target_attribute_map( $block, 'section', (string) $siteforge_section_id, '' )
		);
	}
	$attrs['class'] = implode( ' ', array_unique( preg_split( '/\s+/', trim( $attrs['class'] ) ) ) );

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
 * Build one exact nested target identity. Missing identities fail closed and
 * produce no target attributes; positional/index identities are forbidden.
 */
function oneclick_siteforge_target_attribute_map( $block, $kind, $local_id, $display_value = '', $parent_kind = '', $parent_id = '' ) {
	$allowed = array( 'section', 'headline', 'image', 'cta', 'repeater_item', 'form_control' );
	if (
		! in_array( $kind, $allowed, true ) ||
		! is_string( $local_id ) ||
		! preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/', $local_id )
	) {
		return array();
	}
	$page_id = (string) get_post_meta( get_the_ID(), '_siteforge_v3_resource_id', true );
	$section_id = is_array( $block )
		? (string) ( $block['siteforgeSectionId'] ?? ( $block['data']['_siteforge_section_id'] ?? '' ) )
		: '';
	if ( ! preg_match( '/^page:[A-Za-z0-9._:-]+$/', $page_id ) || ! preg_match( '/^section:[A-Za-z0-9._:-]+$/', $section_id ) ) {
		return array();
	}
	$path = array(
		array( 'kind' => 'page', 'id' => $page_id ),
		array( 'kind' => 'section', 'id' => $section_id ),
	);
	if (
		'repeater_item' === $parent_kind &&
		is_string( $parent_id ) &&
		preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/', $parent_id )
	) {
		$path[] = array( 'kind' => 'repeater_item', 'id' => $parent_id );
	}
	if ( 'section' !== $kind ) {
		$path[] = array( 'kind' => $kind, 'id' => $local_id );
	}
	$target_id = implode(
		'/',
		array_map(
			static function ( $segment ) {
				return $segment['kind'] . ':' . $segment['id'];
			},
			$path
		)
	);
	return array(
		'data-siteforge-target-id'    => $target_id,
		'data-siteforge-target-kind'  => $kind,
		'data-siteforge-resource-path'=> wp_json_encode( $path, JSON_UNESCAPED_SLASHES ),
		'data-siteforge-display-value'=> wp_strip_all_tags( (string) $display_value ),
	);
}

function oneclick_siteforge_target_attributes( $block, $kind, $local_id, $display_value = '', $parent_kind = '', $parent_id = '' ) {
	$output = '';
	foreach ( oneclick_siteforge_target_attribute_map( $block, $kind, $local_id, $display_value, $parent_kind, $parent_id ) as $key => $value ) {
		$output .= ' ' . esc_attr( $key ) . '="' . esc_attr( $value ) . '"';
	}
	return $output;
}

/**
 * Repeater identities must be explicit and persist with the data. Never use a
 * rendered position as identity.
 */
function oneclick_siteforge_repeater_item_id( $item ) {
	if ( ! is_array( $item ) ) {
		return '';
	}
	foreach ( array( 'target_id', 'itemId', 'item_id', 'id', 'fieldId' ) as $key ) {
		$value = $item[ $key ] ?? '';
		if ( is_string( $value ) && preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/', $value ) ) {
			return $value;
		}
	}
	return '';
}

/**
 * Read an ACF block field while supporting SiteForge's deterministic flattened
 * repeater representation when WordPress has not persisted ACF field-key
 * references alongside the block data.
 */
function oneclick_get_block_field( $field_name, $block, $fallback = '' ) {
	$value = function_exists( 'get_field' ) ? get_field( $field_name ) : null;
	$data  = isset( $block['data'] ) && is_array( $block['data'] ) ? $block['data'] : array();

	if ( ! array_key_exists( $field_name, $data ) ) {
		return false !== $value && null !== $value ? $value : $fallback;
	}

	$raw_value = $data[ $field_name ];
	if ( is_numeric( $raw_value ) && absint( $raw_value ) > 0 ) {
		$rows = array();
		for ( $index = 0; $index < absint( $raw_value ); $index++ ) {
			$prefix = $field_name . '_' . $index . '_';
			$row    = array();
			foreach ( $data as $key => $item_value ) {
				if ( 0 === strpos( $key, $prefix ) ) {
					$row[ substr( $key, strlen( $prefix ) ) ] = $item_value;
				}
			}
			if ( ! empty( $row ) ) {
				$rows[] = $row;
			}
		}
		if ( ! empty( $rows ) ) {
			return $rows;
		}
	}

	return false !== $value && null !== $value ? $value : $raw_value;
}

/**
 * Finite component variants shared by generated artifacts and live rendering.
 */
function oneclick_siteforge_variant_catalog() {
	return array(
		'acf/top-slides'         => array( 'cinematic', 'editorial', 'split', 'panoramic', 'immersive', 'minimal' ),
		'acf/text-section'       => array( 'editorial', 'contained', 'lead' ),
		'acf/feature-section'    => array( 'alternating', 'bleed', 'framed', 'spotlight', 'collage', 'compact' ),
		'acf/image'              => array( 'full-bleed', 'contained' ),
		'acf/links'              => array( 'inline', 'banner', 'sticky' ),
		'acf/content-grid'       => array( 'amenity-grid', 'tabs', 'editorial', 'bento', 'icon-list', 'carousel' ),
		'acf/form'               => array( 'card', 'split', 'minimal' ),
		'acf/map'                => array( 'standard', 'immersive' ),
		'acf/html-section'       => array( 'contained', 'full-width' ),
		'acf/gallery'            => array( 'categorized', 'masonry', 'lightbox', 'filmstrip', 'mosaic', 'full-bleed' ),
		'acf/accordion-section'  => array( 'bordered', 'minimal' ),
		'acf/plans-availability' => array( 'cards', 'details', 'preleasing' ),
		'acf/poi'                => array( 'narrative', 'map-list', 'editorial' ),
		'acf/testimonials'       => array( 'cards', 'spotlight', 'carousel' ),
		'acf/menu'               => array( 'standard', 'sticky-cta' ),
		'acf/offering-browser'   => array( 'cards', 'list', 'availability' ),
		'acf/entity-directory'   => array( 'cards', 'map', 'grouped' ),
		'acf/comparison-table'   => array( 'table', 'cards', 'compact' ),
		'acf/timeline'           => array( 'vertical', 'horizontal', 'milestones' ),
		'acf/document-library'   => array( 'list', 'cards', 'grouped' ),
		'acf/events-directory'   => array( 'cards', 'calendar', 'list' ),
		'acf/governed-component' => array( 'governed' ),
	);
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
	$image_id = 0;
	if ( is_array( $image ) ) {
		$image_id = absint( $image['ID'] ?? $image['id'] ?? 0 );
	} elseif ( is_numeric( $image ) ) {
		$image_id = absint( $image );
	}

	if ( $image_id ) {
		return wp_get_attachment_image( $image_id, $size, false, $attr );
	}

	$image_url = is_array( $image ) ? ( $image['url'] ?? '' ) : '';
	if ( is_string( $image_url ) && wp_http_validate_url( $image_url ) ) {
		$class = isset( $attr['class'] ) ? $attr['class'] : 'responsive-image';
		$alt   = isset( $attr['alt'] ) ? $attr['alt'] : ( $image['alt'] ?? '' );
		return sprintf(
			'<img src="%s" class="%s" alt="%s" loading="lazy" decoding="async">',
			esc_url( $image_url ),
			esc_attr( $class ),
			esc_attr( $alt )
		);
	}

	return '';
}

/**
 * Identify deterministic SiteForge placeholder media after WordPress has
 * converted an asset reference into an attachment ID.
 */
function oneclick_is_placeholder_image( $image ) {
	$image_id  = 0;
	$image_url = '';
	$image_alt = '';

	if ( is_array( $image ) ) {
		$image_id  = absint( $image['ID'] ?? $image['id'] ?? 0 );
		$image_url = (string) ( $image['url'] ?? '' );
		$image_alt = (string) ( $image['alt'] ?? '' );
	} elseif ( is_numeric( $image ) ) {
		$image_id = absint( $image );
	}

	if ( $image_id ) {
		$image_url = (string) wp_get_attachment_url( $image_id );
		$image_alt = (string) get_post_meta( $image_id, '_wp_attachment_image_alt', true );
	}

	return false !== stripos( $image_url, 'property-placeholder' ) ||
		false !== stripos( $image_alt, 'placeholder' );
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
