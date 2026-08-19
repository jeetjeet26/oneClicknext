<?php
/**
 * Deterministic renderer for data-only governed components.
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'oneclick_render_governed_component_node' ) ) {
	function oneclick_render_governed_component_node( $node, $values, $block, $component_key ) {
		if ( ! is_array( $node ) || empty( $node['nodeId'] ) || empty( $node['primitive'] ) ) {
			return '';
		}
		$tags = array(
			'section' => 'section', 'container' => 'div', 'grid' => 'div', 'stack' => 'div',
			'text' => 'p', 'image' => 'figure', 'button' => 'a', 'list' => 'ul',
			'form' => 'form', 'tabs' => 'div', 'accordion' => 'div', 'modal' => 'dialog',
			'carousel' => 'div',
		);
		if ( ! isset( $tags[ $node['primitive'] ] ) ) {
			return '';
		}
		$node_id = (string) $node['nodeId'];
		if ( ! preg_match( '/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/', $node_id ) ) {
			return '';
		}
		$tag = $tags[ $node['primitive'] ];
		$classes = array( 'governed-' . sanitize_html_class( $node['primitive'] ) );
		foreach ( is_array( $node['classes'] ?? null ) ? $node['classes'] : array() as $class_name ) {
			if ( preg_match( '/^[a-z][a-z0-9-]*$/', $class_name ) ) {
				$classes[] = $class_name;
			}
		}
		$properties = is_array( $node['properties'] ?? null ) ? $node['properties'] : array();
		$resolve = static function ( $value ) use ( $values ) {
			if ( is_array( $value ) && isset( $value['field'] ) && is_string( $value['field'] ) ) {
				return $values[ $value['field'] ] ?? '';
			}
			return $value;
		};
		$target_kind = array(
			'text' => 'headline', 'image' => 'image', 'button' => 'cta', 'form' => 'form_control',
		)[ $node['primitive'] ] ?? 'repeater_item';
		$display = $resolve( $properties['value'] ?? ( $properties['label'] ?? '' ) );
		$target_attributes = oneclick_siteforge_target_attributes( $block, $target_kind, $node_id, is_scalar( $display ) ? (string) $display : '' );
		$accessibility = is_array( $node['accessibility'] ?? null ) ? $node['accessibility'] : array();
		$aria = '';
		if ( ! empty( $accessibility['role'] ) ) {
			$aria .= ' role="' . esc_attr( $accessibility['role'] ) . '"';
		}
		$name = $resolve( $accessibility['name'] ?? null );
		if ( is_string( $name ) && '' !== $name ) {
			$aria .= ' aria-label="' . esc_attr( $name ) . '"';
		}
		if ( 'dialog' === $tag ) {
			$aria .= ' aria-modal="true"';
		}
		$attributes = ' class="' . esc_attr( implode( ' ', array_unique( $classes ) ) ) . '"' . $target_attributes . $aria;
		if ( 'a' === $tag ) {
			$href = $resolve( $properties['href'] ?? '#' );
			$attributes .= ' href="' . esc_url( is_string( $href ) ? $href : '#' ) . '"';
		}
		if ( 'form' === $tag ) {
			$attributes .= ' method="post"';
		}
		$output = '<' . $tag . $attributes . '>';
		if ( 'text' === $node['primitive'] || 'button' === $node['primitive'] ) {
			$output .= esc_html( is_scalar( $display ) ? (string) $display : '' );
		} elseif ( 'image' === $node['primitive'] ) {
			$asset = $resolve( $properties['asset'] ?? null );
			$alt = $resolve( $properties['alt'] ?? ( $accessibility['name'] ?? '' ) );
			$output .= oneclick_get_image_html(
				$asset,
				'large',
				array( 'class' => 'governed-image', 'alt' => is_string( $alt ) ? $alt : '' )
			);
		}
		foreach ( is_array( $node['children'] ?? null ) ? $node['children'] : array() as $child ) {
			$output .= oneclick_render_governed_component_node( $child, $values, $block, $component_key );
		}
		$output .= '</' . $tag . '>';
		return $output;
	}
}

$component_key = oneclick_get_block_field( 'component_key', $block, '' );
$descriptor_hash = oneclick_get_block_field( 'descriptor_hash', $block, '' );
$render_plan = oneclick_get_block_field( 'render_plan', $block, array() );
$component_values = oneclick_get_block_field( 'component_values', $block, array() );
if ( is_string( $render_plan ) ) {
	$render_plan = json_decode( $render_plan, true );
}
if (
	! is_string( $component_key ) ||
	! preg_match( '/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/', $component_key ) ||
	! is_string( $descriptor_hash ) ||
	! preg_match( '/^[a-f0-9]{64}$/', $descriptor_hash ) ||
	! is_array( $render_plan )
) {
	return;
}
$component_values = is_array( $component_values ) ? $component_values : array();
?>
<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-governed-component', 'data-siteforge-component' => $component_key, 'data-siteforge-descriptor-hash' => $descriptor_hash ) ); ?>>
	<?php echo oneclick_render_governed_component_node( $render_plan, $component_values, $block, $component_key ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
</section>
