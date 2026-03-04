<?php
/**
 * Block: Lead Capture Form
 *
 * @package oneClick SiteForge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$heading = get_field( 'heading' );
$subheading = get_field( 'subheading' );
$form_type = get_field( 'form_type' ) ?: 'contact';
$redirect_url = get_field( 'redirect_url' );
$api_endpoint = oneclick_get_field( 'lead_capture_endpoint' );
?>

<section <?php echo oneclick_get_block_wrapper_attributes( array( 'class' => 'block-form' ) ); ?>>
	<div class="site-container">
		<div class="form-wrapper">
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

			<form class="lead-form" data-type="<?php echo esc_attr( $form_type ); ?>" data-endpoint="<?php echo esc_attr( $api_endpoint ); ?>">
				<div class="form-group">
					<label for="form-name">
						<?php esc_html_e( 'Name', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="text" id="form-name" name="name" required aria-required="true">
				</div>

				<div class="form-group">
					<label for="form-email">
						<?php esc_html_e( 'Email', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="email" id="form-email" name="email" required aria-required="true">
				</div>

				<div class="form-group">
					<label for="form-phone">
						<?php esc_html_e( 'Phone', 'oneclick-siteforge' ); ?>
						<span class="required">*</span>
					</label>
					<input type="tel" id="form-phone" name="phone" required aria-required="true">
				</div>

				<?php
				if ( 'tour' === $form_type ) {
					?>
					<div class="form-group">
						<label for="form-tour-date">
							<?php esc_html_e( 'Preferred Tour Date', 'oneclick-siteforge' ); ?>
						</label>
						<input type="date" id="form-tour-date" name="tour_date">
					</div>

					<div class="form-group">
						<label for="form-tour-time">
							<?php esc_html_e( 'Preferred Tour Time', 'oneclick-siteforge' ); ?>
						</label>
						<input type="time" id="form-tour-time" name="tour_time">
					</div>
					<?php
				}
				?>

				<div class="form-group">
					<label for="form-message">
						<?php esc_html_e( 'Message', 'oneclick-siteforge' ); ?>
					</label>
					<textarea id="form-message" name="message" rows="5"></textarea>
				</div>

				<div class="form-group form-checkbox">
					<label for="form-consent">
						<input type="checkbox" id="form-consent" name="consent" required aria-required="true">
						<?php esc_html_e( 'I consent to be contacted about this property', 'oneclick-siteforge' ); ?>
					</label>
				</div>

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
