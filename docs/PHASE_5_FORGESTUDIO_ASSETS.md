# Phase 5 — ForgeStudio asset library and replacement evidence

Local checkpoint, September 17, 2026. Phase 5 remains active.

## Completed local behavior

The library now supports bounded, paginated search, folders, favorites, active/archive views, metadata edits, usage review, archive/restoration and saved versions. Failed reads and stale edits remain visible and reloadable. Rights/expiry are owner advisories under the existing ForgeStudio policy; approval and duplicates still gate new use. BrandForge retains its separate stricter review contract.

Uploads inspect actual image bytes or video signatures, enforce size limits and save an exact content hash. A stable request precedes immutable local storage; matching retries recover the original asset. Identical files reuse an existing asset. Pending uploads have a paginated recovery panel. Replacement checks the original revision twice, archives and links the old asset, and retains its original file. A changed original can be reviewed and the uploaded file kept separately. Restoring an archive returns it to pending approval.

Source review now compares immutable file identity, follows replacement candidates, allows explicit media selection/removal and format changes, and saves a new pending revision. Saved historical variants retain their original media. Approval/scheduling remain disabled while source edits are unsaved. Brief generation refuses a missing or unapproved selected asset before model work.

Semantic records commit with asset save/review/archive/restore, upload request/result/replacement and recovery decisions. Full private versions retain review notes; shared records carry safe summaries. Completed upload identity and original files cannot be changed or hard-deleted through the library. The direct arbitrary-URL registration/delete routes are retired.

## Verification

258 ForgeStudio service/API cases across 41 suites; 218 rollback-only SQL assertions across editorial/publication/generation/sources/assets; 15 combined browser journeys passed. New browser evidence includes real local storage, lost replies, replacement, pending-upload recovery, pagination, stale edits, archive/restoration and explicit campaign replacement. Mobile asset/source review inspected. Full TypeScript and schema type sync pass. Changed-file lint has no errors (two existing warnings). 137 installed SQL function bodies match migrations; fixture and migration-history checks are zero. Local database advisors remain at the same 1,333 warning/error keys, with no additions.

## Limits and next work

Media model execution still needs durable intent/result and stop/recovery qualification; it is the next increment. Legacy assets outside the managed upload path do not gain proof of immutable remote bytes. No real model, provider, delivery, hosted mutation, deployment, training or migration-history write occurred. Outcomes, remaining interaction/system recording and the wider product register stay open. Real-client/provider acceptance remains deferred.
