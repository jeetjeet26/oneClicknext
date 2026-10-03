# Phase 5 — CRM saved bulk work

Local checkpoint, September 17, 2026. CRM and Phase 5 remain in progress.

## Implemented

The CRM console supports a property-scoped, paginated lead search and an explicit selection of up to 100 leads across pages. Search treats punctuation literally. Saving creates an immutable, canonically ordered selection and exact child transfer values under the actual operator. Existing links, unfinished transfers, missing contact information and unqualified setup are recorded as exclusions; a later configuration or lead change cannot silently add them to execution.

A stable request identity recovers an interrupted save. Batch approval binds to the exact saved manifest, current manager/admin access and the original operator. Every prepared child is locked and checked before any new approval; one changed lead, configuration or transfer holds the approval. All child approvals, queue projections, batch receipt and semantic history commit together. Failure rolls everything back. The existing durable worker processes only approved saved child identities; the bulk endpoint does not accept credentials or payloads and never calls a provider directly. Outbound pause prevents approval at the server boundary.

A batch stop cancels only its own queued/searching children. Confirmed destinations and uncertain writes remain unchanged. Counts come from actual saved child states, so partial outcomes never become a blanket success. Reopening the review shows exact saved values and changed-source warnings; each prepared item opens its individual transfer and destination-recovery controls directly. No-match/uncertain evidence does not authorize a resend. A recorded stop cannot be used to reopen a batch.

Private batches and command receipts have service-only grants, RLS and immutable-history guards. Current property membership is required for reads; current manager/admin access is required for commands. Shared history records preparation, approval and stop outcomes with counts and hashes, excluding private contact values and credentials. Individual transfer receipts continue to record actual outcomes. These events remain ineligible for training. Selection clicks and broader system/interaction coverage are not claimed complete.

## Verification

- 65 focused web API/service cases across bulk requests, single transfers and queue behavior.
- 43 new rollback-only bulk assertions: scope, canonical retry identity, immutable selection, literal search, private access, exact approval, stale inputs, role loss, atomic failure recovery, shared projections, partial outcomes and stop/retry behavior. Related CRM setup/delivery, TourSpark, BrandForge, LeadPulse and schema-access suites also pass: 370 assertions across seven SQL suites.
- Five new browser/persistence journeys cover lost save replies and reload, selection across pages, exclusions, partial results, direct destination recovery, stale values, and four simultaneous prepare/approval requests. Six existing transfer journeys also pass. One old text assertion was scoped to the transfer panel because the new lead-search list shows the same contact. Provider results and qualification are explicit local fixtures.
- Full web type checking, targeted lint and schema/type version check pass. Mobile and desktop screenshots inspected; mobile horizontal overflow check passed.
- 94 current saved function bodies match the local database. Fixtures and new migration-history entries are zero. Local advisors remain at 1,333 existing WARN/ERROR findings, with none added, removed or changed.

Migration `20260917163319_phase_five_crm_bulk.sql` is applied only locally. Schema types were regenerated from the local database, retaining tested nullable argument contracts. No hosted mutation, provider send, deployment, backlog replay, commit, push, paid generation, training or export occurred. Delivery remains paused.

## Remaining gates

Provider-specific qualification/activation, explicit acknowledgment/read/cleanup capabilities, uncertain-note evidence, conflicting destinations, reviewed legacy links/account transfer, monitoring and remaining source/system/interaction coverage stay open. Real client/provider acceptance is deferred while independent development continues. The other retained products and agency permission/budget/intervention/outcome gates remain in the readiness register. This checkpoint does not claim client readiness or autonomy readiness for the entire platform.
