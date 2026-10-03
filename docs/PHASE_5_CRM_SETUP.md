# Phase 5 — CRM mapping review and saved setup checks

Local development checkpoint, September 16, 2026. Phase 5 and CRM product qualification remain open.

## Completed local journeys

The CRM settings workspace now saves private, versioned credentials and mappings before review. It can recover a lost acknowledgment, reject stale changes, preview examples or a property-scoped lead, and approve the exact saved mapping. Duplicate targets are rejected. Changes to lead values invalidate an unapproved preview; changes to configuration invalidate previous mapping approval and provider readiness. API status responses do not include credentials. A restrictive policy prevents authenticated browser reads/writes of CRM credential rows while preserving existing non-CRM policies. Manager/admin authority is checked against current database membership.

Mapping approval does not authorize delivery. Legacy client `validated` flags no longer establish readiness. The old create/read/delete validation endpoint and direct mapping-save/learning-correction paths require the new workflow. Credential inputs cover the supported providers, including Salesforce OAuth instance/token fields, without loading stored keys into the browser. Delayed reads and deferred input updates cannot overwrite the current mapping draft.

Connection and schema checks have saved identities, a single worker claim, immutable results, reload/continue/stop controls, and version/access fencing. Two workers cannot repeat one check. A stopped or changed configuration retains a late receipt without accepting it. Schema results distinguish provider responses, documented defaults, mixed evidence and Lasso public-registration credential-format checks. Suggested mappings use known field names and require review; no model call or global cross-property learning update is used. Field lists are bounded, and incomplete lists remain limited evidence. Read checks never write a lead or activate delivery.

Custom endpoint reads use the existing DNS-pinned HTTP transport with HTTPS, bounded responses, credential header restrictions and no redirects. Salesforce setup accepts official instance hosts. Raw provider exception bodies are not returned as setup results. The private worker claim is never returned to the browser.

A failed duplicate search is no longer treated as confirmed absence. Missing/unqualified setup reports that no record was sent and preserves an existing external link. These fixes do not replace the remaining delivery lifecycle.

## Action and learning evidence

Private immutable mapping reviews retain exact mappings, source preview snapshots, hashes, actor, request and configuration revision. Provider setup receipts retain actual results separately from requests. Shared history records mapping save/preview/approval and setup request/completion/stop with safe summaries. It excludes tokens and lead contact values. All new shared actions remain training-ineligible. Existing system-action attribution limitations remain; no synthetic human actor is introduced.

## Verification

- 57 web service/API cases across six suites.
- 36 Python CRM cases and 18 HTTP transport cases.
- 59 CRM SQL assertions plus 213 related action-history, tour-action, BrandForge and LeadPulse assertions, run serially with rollback-only fixtures.
- Six local browser/persistence journeys, including four simultaneous retries producing one claim and one receipt. Browser flows: lost-save recovery/private status, stale lead preview and credential rotation, duplicate mapping rejection, lost-discovery recovery/limited evidence, and stopped late results. Screenshots inspected on desktop and phone.
- Full web type checking and targeted lint passed.
- 67 function bodies across eight current migrations match the local database. Fixtures and new migration-history entries are zero.
- Local database advisors retain 1,365 existing WARN/ERROR findings with no additions or changes. This is not a clean-database claim.

Migration `20260917005809_phase_five_crm_review.sql` has been applied only to the local schema. Ship web, worker and schema together at the existing release gate. Test providers were mocked or represented by explicit local receipts; no real provider validation, send, hosted migration, deployment, backlog replay, commit, push, training or training export occurred. Delivery remains paused.

## Next CRM work

Complete deliberate provider qualification/activation, durable per-record delivery and note receipts, uncertain-write reconciliation, saved bulk selection/recovery, reviewed retries and account replacement. Legacy delivery APIs and monitor statistics are not qualified by this checkpoint. A read/schema check is insufficient proof of create/read/cleanup capabilities or actual delivery. Do not mark those gates complete or resume legacy backlogs. Continue the remaining retained products and semantic-action register afterward; real-client acceptance may remain deferred while independent local work proceeds.

Subsequent local delivery work is recorded in [PHASE_5_CRM_DELIVERY.md](PHASE_5_CRM_DELIVERY.md). Its checkpoint supersedes the delivery-pending statements above; provider activation and broader CRM completion remain open.
