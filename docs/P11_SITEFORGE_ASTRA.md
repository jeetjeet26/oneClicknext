# SiteForge console generation

SiteForge now starts a website build inside the P11 console with **GPT-6 Astra**. It retains the finished website package in private Supabase Storage. The team does not need to open a Codex project or copy a brief to another application.

## What is included

The server snapshots saved property information, active approved floorplans, approved media and brand assets, the most recent approved creative direction, approved legal copy and approved neighborhood locations. It includes the actual media bytes, hashes and floorplan associations. Billing contacts, CRM credentials, lead records and conversations are excluded. Missing inputs are disclosed; an unavailable approved asset fails preparation before the model is invoked. Expired inventory prices and availability are omitted.

Astra runs with a hosted shell and external networking disabled. The request uses `gpt-6-astra` explicitly, background mode, xhigh reasoning and a 60,000-output-token ceiling. There is no automatic substitution with another model. Uploaded provider input files expire after one day; a successfully retained package also triggers input-file deletion. The source bundle remains privately retained with the P11 build record.

The package includes website source/assets, installation and editing instructions, review notes, component/field bindings and a model-authored build report. WordPress output additionally includes an installable theme ZIP. P11 adds the original source bundle and its own hash receipt. A generated package is **ready for review**, not published or independently approved.

Revisions include the previous website source plus the current property snapshot. Later saved changes are flagged against each retained build. Updating property facts does not silently rewrite a published website.

## Reliability and access

- Internal property admins/managers can generate and download; the client portal does not expose these controls.
- New tables have RLS, no anonymous/authenticated direct grants, and service-only access behind the existing property/operator checks. Storage is private.
- The request identity, source snapshot and completed artifact are immutable. Only one active build is allowed per property.
- The provider request is claimed before submission. An ambiguous submission becomes `uncertain`; automatic retries do not start a second charged build. Operations can reconcile the provider request using the build UUID sent as `X-Client-Request-Id` and response metadata before resolving the retained record.
- The console refresh and a scheduled worker resume saved builds. Transient polling/download failures do not trigger another generation.
- Build transitions and prepared downloads append evidence to the existing action ledger. These events are not eligible for model training.
- ZIP validation rejects unsafe paths, symbolic links, duplicate names, oversized expansion, damaged file checksums and missing required website/hand-off files. Packages must account for every approved floorplan.

Current limits: 500 floorplans, 200 approved media items, 200 neighborhood locations, 5 MB per source media file, 35 MB of source media and a 50 MB retained package. Rights/expiry warnings for assets follow existing advisory behavior. Brand/floorplan asset approval and file identity still apply.

## Local qualification — October 7, 2026

- 26 focused package tests and 10 action-ledger tests passed: package integrity, media/floorplan handoff, missing assets, request recovery, route authorization and evidence labels.
- Local SQL transaction checks passed: ownership, one active build, source/artifact immutability, state changes, private access, central events and authorized download recording.
- Full Next production build, TypeScript and schema-truth/RLS checks passed. Targeted lint passed with one existing effect-state warning in the historical-websites component.
- Real Astra standalone build `cc159057-442f-434c-84ac-90217acb862c` completed using a local test property, one saved floorplan and one approved test image. The retained ZIP was 85,232 bytes, SHA-256 `8a0b1e153f10095d7424ef5b326f72d6bf27e4a82ab97f02d1b20b1605896cdb`.
- Authenticated download returned that exact ZIP and attachment filename; an unauthenticated request returned 401. The embedded browser did not expose a download-completion event, so its native save UI has not been independently confirmed.
- Independently opened the generated Home/Floorplans pages, followed navigation, opened the supplied diagram and used Escape to restore focus. At 390 px, content width matched the viewport and the supplied image loaded.
- Real Astra WordPress build `252127aa-4318-44b1-a14f-337e60d806d9` completed with the same local fixture. The retained ZIP was 302,574 bytes, SHA-256 `a108bedddc555a74f6c7111782b7b3687f28c49195dd09255e0a791bee3f57ef`.
- Independently installed and activated its theme ZIP on an isolated local WordPress 7.1 / PHP 8.2.33 site. Activation did not create starter pages. The optional setup created Home/Floorplans and imported the approved diagram while preserving the original pages. Edited the Home paragraph in the native block editor, saved it, repeated setup, and verified the edited paragraph remained on the rendered home page. The editor had no invalid-block warning. This qualifies the tested package, not every future generated website; each still requires review.
- The embedded browser could not render WordPress's editor iframe; native editing was verified in Chrome. The existing historical-brief browser suites were adjusted for the collapsed history section but were not rerun in full.

## Release boundary

This implementation and both additive migrations have been applied/tested **locally only**. Production Supabase, Vercel and Render have not been changed by this work. Before release, apply `20261007171810_siteforge_astra_packages.sql` and `20261007174450_siteforge_package_download_evidence.sql` to the verified production project after the normal migration review, deploy the web changes, and verify the existing server OpenAI connection and `CRON_SECRET`. The new `/api/cron/siteforge-packages` schedule runs once a minute and retains completed output even when the browser is closed.

The broader blueprint gap register remains in `P11_BLUEPRINT_GAPS.md`; this change does not claim to complete those other product gaps or the deferred production setup work.

## Direct WordPress delivery — local implementation

Ready WordPress packages now offer **Preview → Approve → Deploy to Cloudways** in the console, alongside ZIP download. The property must have ready Cloudways staging and production targets linked to the same website, with matching saved credentials. This screen reuses existing connections; it does not provision a Cloudways application. The Austin demo is connected to the explicitly authorized Aurora staging application.

Preview installs a uniquely named theme on staging after a private database backup. The console imports the complete page manifest automatically and checks all page routes, navigation, imagery and floorplan references. Staff then review the rendered design and interactions. Approval binds the exact package, destination, theme files and saved WordPress content. Changed property inputs or preview content require another review. Production uses Cloudways' native staging push, replacing files and database with the reviewed site, after a verified provider backup. The original production search visibility is restored after the push.

Requests retain their identity and provider receipts. An interrupted result blocks another release to that destination. “Check WordPress without redeploying” reads the saved operation and installed files; it never repeats a push. If the result or search visibility cannot be confirmed, an operator must inspect the retained backup and Cloudways operation. There is no automatic rollback or automatic retry.

The additive migration `20261007223000_siteforge_package_releases.sql` is applied locally only. Local database tests cover destination isolation, exact approval, immutable history, uncertain-operation locking and private access. A disposable WordPress test exercises backup, installation, activation, file verification and database restoration using Docker in place of SSH transport. Cloudways network operations have **not** been exercised against a live staging/production pair; that acceptance check remains before production release. The authorized Aurora staging site has been changed during qualification; production sites have not been changed by this implementation.

## October 7 correction: complete websites, not theme uploads

The earlier acceptance boundary was insufficient: a theme could load while the homepage was empty and navigation led to missing pages. That result must not be described as a finished preview.

The local generation workflow now uses Astra **xhigh** for design/build and its bounded repair pass. It requires a written art direction, complete editable content for Home, Residences, Amenities, Gallery and Contact, and a desktop/mobile render–critique–revision record. A separate Astra visual review evaluates the supplied screenshots. Missing structure/evidence or a rejected design is sent back once with concrete feedback; the repaired candidate faces the same checks. A second failure remains blocked. The review is of generated screenshots, not a certificate for production runtime or accessibility.

WordPress packages must supply `website/siteforge-content.json` and native block HTML content files. The console installs those pages automatically, resolves site/theme asset URLs, preserves conflicting earlier staging pages as drafts, sets the homepage and title, and flushes permalinks. This occurs after a private database backup in the SSH account's home directory; Cloudways' application parent directory is not assumed writable.

Staging acceptance checks every manifest page for HTTP success, substantive main content and its heading; navigation must include every page. The homepage, residences and gallery must contain imagery, referenced images must load, and approved floorplan IDs must appear in the rendered residences content. Approval rechecks this evidence. Earlier theme-only release receipts do not enable the new approval button. These checks catch missing pages and assets, but visual quality and interaction behavior still require the human review step.

The console separates “Website package ready” from “Website checks passed · Awaiting your design approval”. No model setting, builder self-report, successful ZIP download, or theme activation alone means a website is ready.

Verification for the process correction: 44 focused package/API tests passed; the opt-in real WordPress test passed automatic creation of all five pages, homepage selection, URL substitution, theme/file verification and database restoration. TypeScript, targeted lint and the full Next production build passed. Austin evaluation `c8ef8664-fbe0-4b25-a239-f480048e5d8c` completed with Astra xhigh, retained desktop/mobile evidence and passed the separate visual review. Staging release `8e461995-0710-411a-8461-51c28363f78c` passed all five page checks and five unique image checks on October 8. Its first check correctly blocked HTTP asset links; the importer now uses the destination scheme, and the five staging pages were repaired with their previous content retained. Breeze caching initially retained the old homepage; installation now refreshes the current site’s Breeze cache before verification. No deployment was repeated to reconcile the result.

Browser verification on the actual staging installation covered homepage composition, all five routes, mobile navigation, an opened floorplan, and no broken images or horizontal overflow on the tested 390px residences/gallery pages. The real disposable WordPress installer test passed again, as did 36 focused regression tests. Native block editing of this new candidate and complete accessibility conformance remain human-review items. Production was not changed. Preview: https://wordpress-1655141-6620806.cloudwaysapps.com/.
