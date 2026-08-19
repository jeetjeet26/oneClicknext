<?php
/**
 * Block: Lead Capture Form
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading = oneclick_get_block_field( 'heading', $block );
$subheading = oneclick_get_block_field( 'subheading', $block );
$runtime_form = oneclick_get_block_field( '_siteforge_form', $block, array() );
$runtime_integration = oneclick_get_block_field( '_siteforge_integration', $block, array() );
$runtime_form = is_array( $runtime_form ) ? $runtime_form : array();
$runtime_integration = is_array( $runtime_integration ) ? $runtime_integration : array();
$form_type = ! empty( $runtime_form['formType'] ) ? $runtime_form['formType'] : oneclick_get_block_field( 'form_type', $block, 'contact' );
$redirect_url = oneclick_get_block_field( 'redirect_url', $block );
$provider = ! empty( $runtime_integration['provider'] ) ? $runtime_integration['provider'] : oneclick_get_block_field( 'provider', $block, 'unconfigured' );
$provider = 'lumaleasing' === $provider ? 'p11_lumaleasing' : $provider;
$consent_text = oneclick_get_block_field( 'consent_text', $block, __( 'I consent to be contacted about this property.', 'oneclick-siteforge' ) );
$lumaleasing = oneclick_siteforge_lumaleasing_configuration();
$provider_supported = 'p11_lumaleasing' === $provider;
$allowed_destinations = is_array( $runtime_integration['allowedDestinations'] ?? null ) ? $runtime_integration['allowedDestinations'] : array();
$api_endpoint = $provider_supported ? ( $allowed_destinations[0] ?? $lumaleasing['conversionEndpoint'] ) : '';
$provider_supported = $provider_supported && ! empty( $api_endpoint ) && ! empty( $lumaleasing['conversionKey'] );
$runtime_fields = is_array( $runtime_form['fields'] ?? null ) ? $runtime_form['fields'] : array();
if ( ! empty( $runtime_form['consentLegalResourceId'] ) ) {
	$legal_resources = get_option( 'oneclick_siteforge_legal_v3', array() );
	foreach ( is_array( $legal_resources ) ? $legal_resources : array() as $legal_resource ) {
		if ( ( $legal_resource['resourceId'] ?? '' ) === $runtime_form['consentLegalResourceId'] ) {
			$consent_text = $legal_resource['body'];
			break;
		}
	}
}
$submit_label = $runtime_form['submitLabel'] ?? __( 'Submit', 'oneclick-siteforge' );
if ( 'redirect' === ( $runtime_form['successBehavior']['mode'] ?? '' ) ) {
	$redirect_url = $runtime_form['successBehavior']['redirectPath'] ?? '';
}
$block_identity = isset( $block['id'] ) ? (string) $block['id'] : wp_unique_id( 'siteforge-form-' );
$field_id_prefix = 'form-' . sanitize_html_class( $block_identity );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( $block, array( 'class' => 'block-form' ) ); ?>>
	<div class="site-container">
		<div class="form-wrapper">
			<div class="form-intro">
				<?php
				if ( ! empty( $heading ) ) {
					?>
					<h2 class="form-heading"><?php echo wp_kses_post( $heading ); ?></h2>
					<?php
				}

				if ( ! empty( $subheading ) ) {
					?>
					<p class="form-subheading"><?php echo wp_kses_post( $subheading ); ?></p>
					<?php
				}
				?>
			</div>

			<?php if ( $provider_supported ) { ?>
			<form class="lead-form" data-type="<?php echo esc_attr( $form_type ); ?>" data-form-type="<?php echo esc_attr( $form_type ); ?>" data-provider="<?php echo esc_attr( $provider ); ?>" data-endpoint="<?php echo esc_attr( $api_endpoint ); ?>" data-public-key="<?php echo esc_attr( $lumaleasing['conversionKey'] ); ?>">
				<?php
				if ( ! empty( $runtime_fields ) ) {
					foreach ( $runtime_fields as $field ) {
						$field_name = sanitize_key( str_replace( array( 'field:', '.', ':' ), array( '', '_', '_' ), $field['fieldId'] ?? '' ) );
						$field_type = $field['type'] ?? 'text';
						$field_id = $field_id_prefix . '-' . $field_name;
						$required = ! empty( $field['required'] );
						?>
						<div class="form-group form-<?php echo esc_attr( $field_name ); ?>"<?php echo oneclick_siteforge_target_attributes( $block, 'form_control', (string) ( $field['fieldId'] ?? '' ), $field['label'] ?? '' ); ?>>
							<?php if ( 'hidden' !== $field_type ) { ?>
								<label for="<?php echo esc_attr( $field_id ); ?>"><?php echo esc_html( $field['label'] ?? '' ); ?><?php if ( $required ) { ?><span class="required">*</span><?php } ?></label>
							<?php } ?>
							<?php if ( 'textarea' === $field_type ) { ?>
								<textarea id="<?php echo esc_attr( $field_id ); ?>" name="<?php echo esc_attr( $field_name ); ?>"<?php if ( $required ) { ?> required aria-required="true"<?php } ?>></textarea>
							<?php } elseif ( 'select' === $field_type ) { ?>
								<select id="<?php echo esc_attr( $field_id ); ?>" name="<?php echo esc_attr( $field_name ); ?>"<?php if ( $required ) { ?> required aria-required="true"<?php } ?>>
									<?php foreach ( $field['options'] ?? array() as $option ) { ?><option value="<?php echo esc_attr( $option ); ?>"><?php echo esc_html( $option ); ?></option><?php } ?>
								</select>
							<?php } elseif ( in_array( $field_type, array( 'checkbox', 'radio' ), true ) ) { ?>
								<?php foreach ( $field['options'] ?? array( '1' ) as $option ) { ?><label><input type="<?php echo esc_attr( $field_type ); ?>" name="<?php echo esc_attr( $field_name ); ?><?php echo 'checkbox' === $field_type ? '[]' : ''; ?>" value="<?php echo esc_attr( $option ); ?>"<?php if ( $required ) { ?> required aria-required="true"<?php } ?>> <?php echo esc_html( $option ); ?></label><?php } ?>
							<?php } else { ?>
								<input type="<?php echo esc_attr( $field_type ); ?>" id="<?php echo esc_attr( $field_id ); ?>" name="<?php echo esc_attr( $field_name ); ?>"<?php if ( ! empty( $field['autocomplete'] ) ) { ?> autocomplete="<?php echo esc_attr( $field['autocomplete'] ); ?>"<?php } ?><?php if ( $required ) { ?> required aria-required="true"<?php } ?>>
							<?php } ?>
						</div>
						<?php
					}
				} else {
					?>
					<div class="form-group form-name"<?php echo oneclick_siteforge_target_attributes( $block, 'form_control', 'field:name', 'Name' ); ?>><label for="<?php echo esc_attr( $field_id_prefix . '-name' ); ?>"><?php esc_html_e( 'Name', 'oneclick-siteforge' ); ?><span class="required">*</span></label><input type="text" id="<?php echo esc_attr( $field_id_prefix . '-name' ); ?>" name="name" autocomplete="name" required aria-required="true"></div>
					<div class="form-group form-email"<?php echo oneclick_siteforge_target_attributes( $block, 'form_control', 'field:email', 'Email' ); ?>><label for="<?php echo esc_attr( $field_id_prefix . '-email' ); ?>"><?php esc_html_e( 'Email', 'oneclick-siteforge' ); ?><span class="required">*</span></label><input type="email" id="<?php echo esc_attr( $field_id_prefix . '-email' ); ?>" name="email" required aria-required="true"></div>
					<?php
				}
				?>

				<div class="form-group form-checkbox"<?php echo oneclick_siteforge_target_attributes( $block, 'form_control', 'field:consent', $consent_text ); ?>>
					<label for="<?php echo esc_attr( $field_id_prefix . '-consent' ); ?>">
						<input type="checkbox" id="<?php echo esc_attr( $field_id_prefix . '-consent' ); ?>" name="consent" required aria-required="true">
						<?php echo esc_html( $consent_text ); ?>
					</label>
				</div>
				<input type="hidden" name="consent_text" value="<?php echo esc_attr( $consent_text ); ?>">

				<div class="form-message form-success" style="display: none;">
					<?php echo esc_html( $runtime_form['successBehavior']['message'] ?? __( 'Thank you! We will be in touch soon.', 'oneclick-siteforge' ) ); ?>
				</div>

				<div class="form-message form-error" style="display: none;"></div>

				<button type="submit" class="btn btn-primary"<?php echo oneclick_siteforge_target_attributes( $block, 'cta', 'submit', $submit_label ); ?>>
					<?php echo esc_html( $submit_label ); ?>
				</button>

				<?php
				if ( ! empty( $redirect_url ) ) {
					?>
					<input type="hidden" name="redirect_url" value="<?php echo esc_url( $redirect_url ); ?>">
					<?php
				}
				?>
			</form>
			<?php } else { ?>
				<div class="form-message form-unavailable" role="status" data-provider="<?php echo esc_attr( $provider ); ?>">
					<?php esc_html_e( 'This form is unavailable because its conversion provider is not supported by this artifact.', 'oneclick-siteforge' ); ?>
				</div>
			<?php } ?>
		</div>
	</div>
</section>
