# Acacia: preserve the live installation through the console upgrade

Prepared October 2, 2026. Implementation and testing are local. Production has not been deployed or migrated, and no real Lasso lead, note, email, or chatbot message was sent.

Acacia does not need new credentials, a replacement field mapping, or a new chatbot embed for this change. Its current Lasso connection uses public-registration credentials. These can submit registrations but do not establish the read/search capabilities required by the newer provider-qualification flow. The upgrade now preserves that exact existing connection explicitly instead of disabling it or inventing qualification evidence.

## What changes

- Migration `20261002212425_preserve_live_crm_and_chatbot_compatibility.sql` captures eligible, already-connected Lasso installations using hashes of their existing credentials and mappings. It does not copy secrets into another table or rewrite the connection. Only a single, previously validated connection with the existing official Lasso endpoint is eligible. Changed credentials, mappings, property ownership, or configuration revision invalidate this continuity path.
- New pending leads are prepared as durable CRM handoffs by the existing synchronization cron. The worker uses the saved connection and mapping. A recorded write intent permits one submission; a timeout or missing acknowledgment never authorizes a second submission.
- The existing public-registration connection does not perform provider duplicate searches. The receipt says so. Known local matches are held for review. This does not promise deduplication against people present only in Lasso.
- A completed Lasso response with a record identifier can confirm creation. An asynchronous acceptance or an unidentified result remains uncertain. Follow-up notes require a known destination; older leads must match the destination captured at upgrade. A note acknowledgment must identify the note, not merely its parent registrant.
- Pre-upgrade leads and their former statuses are retained. Leads without a known CRM identifier are shown as needing review and are not automatically resubmitted. Existing destination IDs are retained. New follow-up notes for linked leads can be delivered without creating another registrant.
- Approved chatbot facts remain available when they are merely older than seven days. Staff see a routine-review reminder. Explicitly stale, withdrawn, changed, or unapproved facts still follow their existing review restrictions. No knowledge regeneration or timestamp rewriting occurs.
- The internal CRM screen explains that the existing connection is preserved. Field discovery remains available. An unchanged connection cannot accidentally be saved as a new setup from that screen.

## Local verification

The complete 129-migration pending bundle was applied to a disposable database restored from the verified production schema. Its synthetic legacy fixture includes Acacia-shaped Lasso credentials/mapping, a pending lead, a linked lead, July-dated approved chatbot facts, an active widget key, and floorplan/availability links. Preservation checks run both immediately after migration and after the database test suites.

The final rehearsal passed all 121 eligible database suites, including 27 dedicated continuity assertions, and matched the expected candidate schema without drift. The dedicated `reviewflow_responses.test.sql` suite remains outside that runner; its separately authorized 35-assertion qualification is recorded in `PHASE_5_REVIEWFLOW_RESPONSE_QUALIFICATION.md`. This is not whole-platform live acceptance.

Additional evidence includes 63 Python tests; 7 CRM browser journeys, including discovery and the preserved-connection screen; 5 distinct facts browser journeys, including the age reminder and failure recovery; application unit tests; the production build; lint; and a local Supabase database lint run with no errors. Provider responses in these tests are synthetic. They establish local compatibility, not a live Lasso acceptance test.

The fresh read-only production catalog comparison found zero drift across 2,858 catalog objects and 155 migration-history entries. The production security advisor read still reports existing notices; no hosted security setting was changed by this work. Review those separately before broader platform release. [Supabase database advisor guidance](https://supabase.com/docs/guides/database/database-linter).

Release preparation subsequently regenerated all database types from the qualified production-schema upgrade database and applied the repository's existing nullable-argument normalization. The full type check and production build passed. The earlier discrepancies in `content_templates.sample_output` and `siteforge_visual_baselines.system_policy_decision_id` belong to the active development database: both fields were verified in production and in the upgrade rehearsal. No production schema repair was needed for those fields.

The October 2 release preflight also restored a fresh private production data/schema backup into a new isolated local database and successfully applied all 129 migrations there. Acacia's credentials, field mapping, widget key, URLs and approved facts matched the live configuration exactly afterward, and its preserved-connection contract remained eligible. No application or worker was connected to that copy, and no external provider operation was executed. These checks do not replace the post-deployment acceptance below.

Two test corrections accompany verification: a ReviewFlow pagination fixture now avoids randomly choosing the same row for a posted-response case and a mutable cursor case; the facts navigation test expects the newly selected property's empty facts after the app clears the old version selection. Both still verify the intended integrity/privacy behavior.

## Production release sequence — not executed

1. Recheck production drift and the current Acacia connection shape immediately before release. Preserve the existing provider credentials, field mapping, widget key, property IDs, and URL settings. Review the outstanding legacy lead queue against Lasso before deciding which records actually need a first submission.
2. Pause CRM sending in every old scheduler and worker and let in-flight operations settle before the database snapshot/migration. Pausing only the new worker cannot stop an old process. Retain logs and known destination IDs. Avoid overlapping old and new senders.
3. Apply the reviewed database bundle and deploy the matching web application **and** data-engine worker as a coordinated release. An application-only push is not compatible with the current production schema. Do not reset production or regenerate Acacia's connection.
4. Verify that the preserved-connection screen appears, existing mappings and widget key are unchanged, old pending leads remain visible, and the chatbot can still use its approved facts. Check field discovery without saving a replacement configuration.
5. Explicitly configure the delivery pause setting in both web and worker environments. The new guard defaults to paused; delivery must not be assumed enabled merely because credentials exist. Enable delivery only for the planned acceptance window after all matching components are running.
6. Perform a controlled live chatbot conversation and one identifiable test registration, inspect its mapped fields directly in Lasso, and verify the saved receipt and a follow-up note. Clean up the designated test record through the agreed client process. This acceptance test remains outstanding and is not authorized by a local-only test run.
7. Inspect the historical backlog individually before any resubmission. Never turn an uncertain receipt into a retry solely because a request timed out or an old status says pending. If a live acceptance check fails, pause all senders first and preserve the saved handoff evidence before any application rollback.

The release needs coordination on our side; it does not require Acacia to reinstall its chatbot or reconnect Lasso.
