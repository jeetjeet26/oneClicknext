# Phase 5 — BrandForge sources and asset review

Locally qualified on September 16, 2026. This closes the reviewed import/source/asset increment, not the full BrandForge or Phase 5 product gate.

## Result

- Brand package PDF/text/Markdown extraction now saves a private text snapshot with the original file hash and requesting actor. It does not create retrieval documents, embeddings, or a published knowledge source. Original package binaries are not retained by this intake; the extracted snapshot and original hash are retained.
- Asset uploads record intent before storage, use a deterministic path, verify stored bytes on ambiguous storage replies, and atomically save the asset, private snapshot and shared outcome. Retrying the same input returns one result. Shared history contains hashes and summaries, not license text or package contents. A duplicate file assigned to another role is held for review.
- Rights review requires a current manager/admin, exact saved asset revision and stable request identity. Stale, expired, restricted or duplicate asset approvals are held. Explicit expiry changes and rights revocation are recorded. Omitted license evidence is retained. Direct authenticated writes cannot bypass protected governance fields.
- Import preview and its action commit together against the current brand revision. All requested document/source IDs must exist within the property. Website reads are bounded while streaming. Confirmation continues to recheck current asset rights and the saved preview/brand version.
- The console offers import entry points for new and existing brands. The client review uses named fields, logo previews, color swatches and readable source choices. Source selection and subsequent edits are saved in the approved brand. Asset rights require an explicit confirmation before preparing the preview.
- The wizard preserves successful uploads and exact request identities across failed replies and waits for all uploads to settle before enabling retry. Saved extracted previews for the current brand revision can be resumed after reload; unsaved field edits are not persisted. Outdated previews are not offered for resumption.

## Evidence

- 82 service/API checks across 23 BrandForge suites passed, including existing auth, provider failure, PDF and workflow cases updated for saved-request identities. No model, image or embedding provider was called.
- 43 new SQL assertions passed. Related brand revision (57), general action history (29), and tour action history (57) suites also passed. The older tour fixture now rounds to the hour to avoid its 30-minute test booking crossing midnight.
- Four new browser journeys passed: full package/logo import with deliberately lost source/review/preview replies and an edited source color; stale review and cross-property source rejection; recovery of already-stored bytes; saved-preview reload and newer-brand fencing. The six earlier BrandForge browser journeys also passed after this migration.
- Type checking passed. Targeted lint and readable-screen visual review completed. Local advisors remain at 1,363 existing warnings/errors, with no additions. All five current-session migrations match their 33 local function bodies, with no new history entries or remaining BrandForge/calendar fixtures.

Migration: `20260916231403_phase_five_brand_sources.sql`. Applied only to the local schema. Deploy compatible services and UI at the existing release gate. There has been no hosted change, external delivery, backlog replay, model training, commit or push.

## Remaining gates

Brand conversation interruption/restart recovery is now qualified locally: failed first responses remain at the conversation step, read-only reload restores saved state, pending requests can be stopped, and lost committed replies do not repeat messages. Provider fallbacks recheck cancellation, saved competitive context is retained, and empty provider responses cannot become invented successful messages. The expanded suite passed 87 checks across 24 suites plus three dedicated browser journeys with provider responses simulated. Full type and targeted lint checks passed. Competitive analysis records and evidence quality, assistant refresh, real generation/image/embedding acceptance, original binary retention requirements, generic asset deletion/other content-library mutations, and remaining meaningful/system actions stay open. The general knowledge uploader still needs its own product-wide qualification; BrandForge package intake no longer uses it. Shared events remain ineligible for training by default.
