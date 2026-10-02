# Phase 5 — BrandForge saved revisions and recovery

September 16, 2026. Local implementation and qualification checkpoint. Phase 5 remains open across the product register; no production or provider acceptance is implied.

## Completed locally

BrandForge records a durable, property-scoped request before brief/generation work and commits its saved result with an attributed shared action. Immutable revision snapshots preserve prior content. Request identity recovers a lost response, current revision checks block stale browser/background writes, and one running operation per brand prevents concurrent saves. Failed and unconfirmed operations remain distinct. A user can stop an open request; late saves are rejected, and subsequent visual/background steps recheck the request before provider work. Stopping a request does not undo an already completed provider charge.

The console resumes a saved draft instead of automatically generating a replacement on mount. Nested section fields can be edited without exposing internal metadata. Edits preserve original provenance and clear inherited approval metadata. All twelve section approvals remain explicit, recorded decisions. Completed brands can start a fresh revision; old snapshots are retained and the old export link is removed from the current brand. Generated/supplied background workflow output becomes a review proposal, rather than approving itself. Reused logo IDs must still refer to the currently approved, rights-cleared property asset and its exact URL.

Imported previews retain their base brand revision and request identity. Confirmation checks current manager access, preview version, referenced assets and content rights inside the same database transaction as brand approval and action history. A changed brand requires a new preview. Repeating the same confirmation recovers the original receipt.

Visual generation reads saved brand context, produces review candidates and enters the affected section's review flow. It does not overwrite an approved book as if its new images had been approved. Unsuccessful generation does not report a saved revision. The actual image provider remains unqualified in this local checkpoint.

PDF export uses a stable request/version identity and attaches its receipt only to the reviewed revision. The client document has headings, readable content, page numbers and color swatches, without raw JSON or internal actor/property identifiers. The local browser fixture's PDF was rendered and inspected. This is not a design/typography acceptance test for real client content or every writing system.

Knowledge publication prepares every embedding before a database transaction replaces the previous brand documents, updates the source receipt and records the publication. Partial vectors, stale work or history failure preserve the old publication. Published documents carry the brand revision and request/source IDs. The shared record reports the committed source and document count. Assistant context is marked stale (an existing review hold is preserved); refreshing that downstream context is explicit pending work, rather than a false success claim.

Direct authenticated writes to the brand table are removed; the existing authenticated read boundary remains. Private prompt inputs, result bodies, claim tokens and revision contents are not included in the shared activity feed. New private functions use fixed search paths and service-only execution. No new training eligibility is granted.

## Evidence

- 39 service/API checks across eight suites pass: command authorization/replay/error handling, client request identity, canonical normalization, background review proposals, saved-revision preparation and complete embedding responses and visual-provider candidate/stop boundaries.
- 57 rollback-only PostgreSQL assertions pass: version history, tenant boundaries, current membership, stale results, concurrency holds, atomic approvals/import confirmation/publication, stopped requests, immutable snapshots, private function/table privileges, old-export invalidation and rollback when history cannot be recorded.
- Six local browser/integration journeys pass: lost edit response with one saved event, stale approval and reload, all twelve approvals plus a real local PDF download and reopening a revision, stopped background result, repeated import confirmation/stale preview, and four simultaneous requests yielding one execution claim. Provider output for generated sections is a saved fixture proposal; no paid model/image/embedding provider was called.
- Five affected shared-history/configuration/authorization/calendar-link SQL regression suites also pass.
- Type checking passes. Targeted lint and React review cover the edited command/review components. The two-page fixture PDF and review/completion screenshots were inspected.
- Local advisors: 1,363 existing WARN/ERROR findings, down 23 from the 1,386 baseline, with no added or changed findings. The changed brand policies are scoped to their actual roles.
- The four migrations in this continuation match 25 current local function definitions; fixture property counts and new migration-history entries are zero.

The migration is `20260916222215_phase_five_brand_revisions.sql`, applied only to the local schema. Ship compatible services/UI with it at the existing release gate. Earlier completed permission, restoration and manual calendar-binding work remains intact. No hosted migration, provider send, deployment, backlog replay, commit, push or model training occurred. External delivery remains paused.

## Remaining product and phase work

Finish shared records and recovery qualification for competitive analysis, preview/source and content-asset upload/rights-review journeys, refresh of published brand knowledge into the assistant, provider-backed visual/generation acceptance, and remaining meaningful interactions. Public/system capture across all products remains broader than these request-owned outcomes. Active-booking account transfer/legacy reconciliation and every remaining retained product gate remain in `P11_PRODUCT_READINESS.md`. This checkpoint does not mark BrandForge or Phase 5 fully complete.
