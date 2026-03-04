# Runbook: Integrations and Credentials

Last Updated: March 2, 2026
Purpose: Manage third-party integrations and secrets safely (Twilio, Resend, Google, etc.).

## 1. Scope
- Provider onboarding and credential rotation.
- OAuth client and redirect validation.
- Domain/sender verification.

## 2. Integration Setup Standard
1. Create least-privilege credentials.
2. Store credentials in deployment secret manager only.
3. Validate callback URLs and environment-specific redirect URIs.
4. Run provider sandbox/live verification tests.

## 3. Rotation Standard
1. Rotate on schedule or incident trigger.
2. Update secrets in all runtimes.
3. Validate end-to-end send/connect flow.
4. Revoke old credentials.
5. Log rotation date and owner.

## 4. Twilio/Resend/Google Verification
- Twilio: test outbound delivery and webhook receipt.
- Resend: domain authentication and production sender validation.
- Google OAuth: consent screen, token refresh, and revoked-token handling.

## 5. Failure Modes and Actions
- `401/403`: credential expired/mis-scoped -> rotate/re-scope.
- `429`: rate limit -> apply backoff and scheduling controls.
- Delivery accepted but not received -> check sender/domain reputation and suppression lists.

## 6. Compliance Requirements
- No secrets in repo.
- Credential ownership and expiration metadata tracked.
- Incident path defined for provider compromise.
