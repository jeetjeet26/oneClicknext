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
$consent_text = oneclick_get_block_field( 'consent_text', $block, __( 'I consent to be contacted about this property.', 'oneclick-siteforge' ) );
$lumaleasing = oneclick_siteforge_lumaleasing_configuration();
$api_endpoint = $lumaleasing['conversionEndpoint'] ?: oneclick_get_field( 'lead_capture_endpoint' );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-form' ) ); ?>>
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

			<form class="lead-form" data-type="<?php echo esc_attr( $form_type ); ?>" data-form-type="<?php echo esc_attr( $form_type ); ?>" data-endpoint="<?php echo esc_attr( $api_endpoint ); ?>" data-public-key="<?php echo esc_attr( $lumaleasing['conversionKey'] ); ?>">
				<div class="form-group form-name">
					<label for="form-name">
						<?php esc_html_e( 'Name', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="text" id="form-name" name="name" required aria-required="true">
				</div>

				<div class="form-group form-email">
					<label for="form-email">
						<?php esc_html_e( 'Email', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="email" id="form-email" name="email" required aria-required="true">
				</div>

				<div class="form-group form-phone">
					<label for="form-phone">
						<?php esc_html_e( 'Phone', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="tel" id="form-phone" name="phone" required aria-required="true">
				</div>

				<?php
				if ( 'tour' === $form_type ) {
					?>
					<div class="form-group form-tour-date">
						<label for="form-tour-date">
							<?php esc_html_e( 'Preferred Tour Date', 'oneclick-siteforge' ); ?>
						</label>
						<input type="date" id="form-tour-date" name="tour_date">
					</div>

					<div class="form-group form-tour-time">
						<label for="form-tour-time">
							<?php esc_html_e( 'Preferred Tour Time', 'oneclick-siteforge' ); ?>
						</label>
						<input type="time" id="form-tour-time" name="tour_time">
					</div>
					<?php
				}
				?>

				<div class="form-group form-message-field">
					<label for="form-message">
						<?php esc_html_e( 'Message', 'oneclick-siteforge' ); ?>
					</label>
					<textarea id="form-message" name="message" rows="5"></textarea>
				</div>

				<div class="form-group form-checkbox">
					<label for="form-consent">
						<input type="checkbox" id="form-consent" name="consent" required aria-required="true">
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
		</div>
	</div>
</section>
