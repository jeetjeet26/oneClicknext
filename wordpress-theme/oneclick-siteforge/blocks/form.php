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
$form_type = oneclick_get_block_field( 'form_type', $block, 'contact' );
$redirect_url = oneclick_get_block_field( 'redirect_url', $block );
$provider = oneclick_get_block_field( 'provider', $block, 'unconfigured' );
$consent_text = oneclick_get_block_field( 'consent_text', $block, __( 'I consent to be contacted about this property.', 'oneclick-siteforge' ) );
$lumaleasing = oneclick_siteforge_lumaleasing_configuration();
$provider_supported = 'p11_lumaleasing' === $provider;
$api_endpoint = $provider_supported ? $lumaleasing['conversionEndpoint'] : '';
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
				<div class="form-group form-name">
					<label for="<?php echo esc_attr( $field_id_prefix . '-name' ); ?>">
						<?php esc_html_e( 'Name', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="text" id="<?php echo esc_attr( $field_id_prefix . '-name' ); ?>" name="name" required aria-required="true">
				</div>

				<div class="form-group form-email">
					<label for="<?php echo esc_attr( $field_id_prefix . '-email' ); ?>">
						<?php esc_html_e( 'Email', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="email" id="<?php echo esc_attr( $field_id_prefix . '-email' ); ?>" name="email" required aria-required="true">
				</div>

				<div class="form-group form-phone">
					<label for="<?php echo esc_attr( $field_id_prefix . '-phone' ); ?>">
						<?php esc_html_e( 'Phone', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="tel" id="<?php echo esc_attr( $field_id_prefix . '-phone' ); ?>" name="phone" required aria-required="true">
				</div>

				<?php
				if ( 'tour' === $form_type ) {
					?>
					<div class="form-group form-tour-date">
						<label for="<?php echo esc_attr( $field_id_prefix . '-tour-date' ); ?>">
							<?php esc_html_e( 'Preferred Tour Date', 'oneclick-siteforge' ); ?>
						</label>
						<input type="date" id="<?php echo esc_attr( $field_id_prefix . '-tour-date' ); ?>" name="tour_date">
					</div>

					<div class="form-group form-tour-time">
						<label for="<?php echo esc_attr( $field_id_prefix . '-tour-time' ); ?>">
							<?php esc_html_e( 'Preferred Tour Time', 'oneclick-siteforge' ); ?>
						</label>
						<input type="time" id="<?php echo esc_attr( $field_id_prefix . '-tour-time' ); ?>" name="tour_time">
					</div>
					<?php
				}
				?>

				<div class="form-group form-message-field">
					<label for="<?php echo esc_attr( $field_id_prefix . '-message' ); ?>">
						<?php esc_html_e( 'Message', 'oneclick-siteforge' ); ?>
					</label>
					<textarea id="<?php echo esc_attr( $field_id_prefix . '-message' ); ?>" name="message" rows="5"></textarea>
				</div>

				<div class="form-group form-checkbox">
					<label for="<?php echo esc_attr( $field_id_prefix . '-consent' ); ?>">
						<input type="checkbox" id="<?php echo esc_attr( $field_id_prefix . '-consent' ); ?>" name="consent" required aria-required="true">
						<?php echo esc_html( $consent_text ); ?>
					</label>
				</div>
				<input type="hidden" name="consent_text" value="<?php echo esc_attr( $consent_text ); ?>">

				<div class="form-message form-success" style="display: none;">
					<?php esc_html_e( 'Thank you! We will be in touch soon.', 'oneclick-siteforge' ); ?>
				</div>

				<div class="form-message form-error" style="display: none;"></div>

				<button type="submit" class="btn btn-primary">
					<?php esc_html_e( 'Submit', 'oneclick-siteforge' ); ?>
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
